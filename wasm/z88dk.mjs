/**
 * z88dk's tools, compiled to WebAssembly, run as processes.
 *
 * Natively, zcc is a driver: it writes temporary files and starts the real
 * tools on them one after another with system() — the preprocessor, the
 * compiler, the optimiser, the assembler, m4 — and they talk only through
 * files and exit codes. This keeps that design:
 *
 * - **A process is a fresh instance.** Every tool is an Emscripten module whose
 *   factory runs main() synchronously (the build's -sWASM_ASYNC_COMPILATION=0),
 *   so instantiating it is starting a process, and its exit code is in hand
 *   when the factory returns. Nothing survives between runs, as natively.
 * - **One filesystem.** The files live in a root filesystem held here. Each
 *   process sees the shared directories (/opt, /tmp, /work) through PROXYFS
 *   mounts of it, so what one tool writes the next one reads.
 * - **A small shell.** zcc's system() calls come here (wasm/system.js) as
 *   command lines; they're split as sh would (quotes, `<`, `>`, `>>`, `2>`),
 *   and the tool named runs to completion before system() returns. `cat`, which
 *   zcc uses to join files, is built in.
 *
 * It runs in a Web Worker (synchronous compilation of large modules isn't
 * allowed on a page's main thread) or under Node.
 */

/** Directories every process shares; anything else is private to it. */
const SHARED = ['/opt', '/tmp', '/work'];

/** sh's status for a command it can't find, and for one that crashed. */
const NOT_FOUND = 127;
const CRASHED = 134;

export class Z88dk {
  /**
   * @param {Object<string, {factory: Function, wasm: ArrayBuffer}>} tools
   *   Each tool's module factory (the default export of its .mjs) and its
   *   .wasm, keyed by the name zcc runs it by (`zcc`, `z88dk-sccz80`, `m4`…).
   * @param {Object} [options]
   * @param {Object<string, string>} [options.env] Environment for every process.
   */
  constructor(tools, { env = {} } = {}) {
    this.tools = tools;
    this.env = env;
    // The root filesystem: any tool's, never run. The others mount it.
    const holder = Object.keys(tools)[0];
    this.root = {
      noInitialRun: true,
      wasmBinary: tools[holder].wasm,
      print: () => {},
      printErr: () => {},
    };
    start(tools[holder].factory, this.root);
    this.fs = this.root.FS;
    for (const dir of SHARED) mkdirs(this.fs, dir);
  }

  /**
   * Runs a command, waiting for it.
   *
   * @param {string[]} argv The program (a tool's name, or a path ending in
   *   one) and its arguments.
   * @param {Object} [options]
   * @param {string} [options.cwd] Its working directory, under a shared one.
   * @returns {{status: number, stdout: string, stderr: string}} Its exit code
   *   (zcc's own and every tool's output, as a terminal would show it).
   */
  run(argv, { cwd = '/work' } = {}) {
    const session = { stdout: [], stderr: [] };
    const status = this.#spawn(argv, { cwd, session });
    return { status, stdout: session.stdout.join('\n'), stderr: session.stderr.join('\n') };
  }

  /**
   * Runs a command line, as zcc's system() would: one command, with
   * redirections (`astyle --quiet < in.c > out.c`).
   *
   * @returns {{status: number, stdout: string, stderr: string}}
   */
  sh(command, { cwd = '/work' } = {}) {
    const session = { stdout: [], stderr: [] };
    const status = this.#system(command, { cwd, session }) >> 8;
    return { status, stdout: session.stdout.join('\n'), stderr: session.stderr.join('\n') };
  }

  /** Writes files into the root filesystem, making directories as needed. */
  writeFile(path, data) {
    mkdirs(this.fs, dirname(path));
    this.fs.writeFile(path, data);
  }

  /** A file's bytes, or null if there is no such file. */
  readFile(path) {
    try {
      return this.fs.readFile(path);
    } catch {
      return null;
    }
  }

  /** Empties a shared directory (between compiles: /tmp, /work). */
  clear(dir) {
    for (const name of this.fs.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      removeTree(this.fs, `${dir}/${name}`);
    }
  }

  /**
   * Unpacks a tar archive (ustar, as `tar --format=ustar` writes it) into the
   * root filesystem under `prefix`.
   *
   * @param {Uint8Array} tar
   * @param {string} [prefix]
   * @returns {number} How many files it held.
   */
  unpack(tar, prefix = '/') {
    let files = 0;
    for (const entry of untar(tar)) {
      const path = `${prefix.replace(/\/$/, '')}/${entry.name}`.replace(/\/+/g, '/');
      if (entry.type === 'dir') {
        mkdirs(this.fs, path);
      } else {
        mkdirs(this.fs, dirname(path));
        this.fs.writeFile(path, entry.data, { canOwn: true });
        files += 1;
      }
    }
    return files;
  }

  /** Starts one process and waits for it; its exit code. */
  #spawn(argv, { cwd, session, stdin = null, stdout = null, stderr = null }) {
    const name = basename(argv[0]);
    if (name === 'cat') return this.#cat(argv, { cwd, session, stdout, stderr });
    const tool = this.tools[name];
    if (!tool) {
      session.stderr.push(`sh: ${argv[0]}: not found`);
      return NOT_FOUND;
    }

    let status;
    let crash;
    const shared = trackingFs(this.fs);
    const process = {
      arguments: argv.slice(1),
      thisProgram: argv[0],
      wasmBinary: tool.wasm,
      // Not redirected, stdin is empty, as /dev/null would be.
      stdin: () => null,
      print: (line) => session.stdout.push(line),
      printErr: (line) => session.stderr.push(line),
      preRun: [
        (module) => {
          const { FS, PROXYFS, ENV } = module;
          for (const dir of SHARED) {
            mkdirs(FS, dir);
            FS.mount(PROXYFS, { root: dir, fs: shared }, dir);
          }
          FS.chdir(cwd);
          Object.assign(ENV, this.env, { PWD: cwd });
          // The standard streams now, so redirections can replace them: the
          // lowest free descriptor is the one a new file gets.
          FS.init();
          const redirect = (fd, path, flags) => {
            FS.close(FS.getStream(fd));
            const stream = FS.open(resolve(cwd, path), flags, 0o666);
            if (stream.fd !== fd) throw new Error(`${path} opened as ${stream.fd}, not ${fd}`);
          };
          if (stdin) redirect(0, stdin, 'r');
          if (stdout) redirect(1, stdout.path, stdout.append ? 'a' : 'w');
          if (stderr) redirect(2, stderr.path, stderr.append ? 'a' : 'w');
        },
      ],
      onExit: (code) => {
        status = code;
      },
      onAbort: (what) => {
        crash = what;
      },
      // zcc's system().
      z88dkSystem: (command) => this.#system(command, { cwd, session }),
    };
    try {
      start(tool.factory, process);
    } catch (error) {
      crash ??= error;
    } finally {
      // Whatever it left open; natively, exiting closes it.
      shared.closeAll();
    }
    if (status !== undefined) return status;
    session.stderr.push(`${name}: ${crash ?? 'stopped without exiting'}`);
    return CRASHED;
  }

  /** A command line from system(): its wait status (exit code << 8). */
  #system(command, { cwd, session }) {
    let parsed;
    try {
      parsed = parseCommand(command);
    } catch (error) {
      session.stderr.push(`sh: ${error.message}`);
      return 2 << 8;
    }
    if (parsed.argv.length === 0) return 0;
    const code = this.#spawn(parsed.argv, { cwd, session, ...parsed.redirects });
    return (code & 0xff) << 8;
  }

  /** `cat file… [> or >> out]`, the only command zcc runs that isn't a tool. */
  #cat(argv, { cwd, session, stdout }) {
    const parts = [];
    for (const name of argv.slice(1)) {
      try {
        parts.push(this.fs.readFile(resolve(cwd, name)));
      } catch {
        session.stderr.push(`cat: ${name}: No such file or directory`);
        return 1;
      }
    }
    const joined = concat(parts);
    if (!stdout) {
      session.stdout.push(new TextDecoder().decode(joined).replace(/\n$/, ''));
      return 0;
    }
    const path = resolve(cwd, stdout.path);
    const before = stdout.append ? (this.readFile(path) ?? new Uint8Array()) : new Uint8Array();
    this.fs.writeFile(path, concat([before, joined]));
    return 0;
  }
}

/**
 * Instantiates a module: synchronously, as the build compiles them, so by the
 * time this returns main() has run (unless `noInitialRun`) and `module` holds
 * the runtime (FS…). The factory's promise is only a formality then; a failure
 * also shows up through `onExit` or `onAbort`, so its rejection is dropped.
 */
function start(factory, module) {
  const ready = factory(module);
  ready?.catch?.(() => {});
  if (!module.FS) throw new Error('the module did not start synchronously');
}

/**
 * The root filesystem as PROXYFS reaches it, for one process: every file it
 * opens is noted, so the ones it never closes can be closed when it exits.
 */
function trackingFs(fs) {
  const open = new Set();
  return Object.assign(Object.create(fs), {
    open(path, flags, mode) {
      const stream = fs.open(path, flags, mode);
      open.add(stream);
      return stream;
    },
    close(stream) {
      open.delete(stream);
      return fs.close(stream);
    },
    closeAll() {
      for (const stream of open) {
        try {
          fs.close(stream);
        } catch {
          // Already closed.
        }
      }
      open.clear();
    },
  });
}

/**
 * Splits a command line as sh would, for the commands zcc writes: words,
 * single and double quotes, backslash escapes, and the redirections `<`, `>`,
 * `>>`, `2>`, `2>>`. Anything else (pipes, `;`, `&&`, variables) is refused.
 *
 * @returns {{argv: string[], redirects: Object}}
 */
export function parseCommand(line) {
  const tokens = [];
  let i = 0;
  const peek = () => line[i];
  while (i < line.length) {
    const c = peek();
    if (c === ' ' || c === '\t' || c === '\n') {
      i += 1;
      continue;
    }
    // An operator, with an optional file descriptor number before it.
    const op = /^(2?>>|2?>|<)/.exec(line.slice(i));
    if (op) {
      tokens.push({ op: op[1] });
      i += op[1].length;
      continue;
    }
    if ('|;&`$()'.includes(c)) {
      throw new Error(`unsupported shell syntax at "${line.slice(i, i + 10)}"`);
    }
    // A word: runs of unquoted, single- and double-quoted text.
    let word = '';
    while (i < line.length && !' \t\n<>|;&'.includes(peek())) {
      const ch = line[i];
      if (ch === "'") {
        const end = line.indexOf("'", i + 1);
        if (end < 0) throw new Error('unterminated quote');
        word += line.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '"') {
        i += 1;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\' && '"\\$`'.includes(line[i + 1])) i += 1;
          word += line[i];
          i += 1;
        }
        if (i >= line.length) throw new Error('unterminated quote');
        i += 1;
      } else if (ch === '\\') {
        word += line[i + 1] ?? '';
        i += 2;
      } else if ('`$()'.includes(ch)) {
        throw new Error(`unsupported shell syntax at "${line.slice(i, i + 10)}"`);
      } else {
        word += ch;
        i += 1;
      }
    }
    tokens.push({ word });
  }

  const argv = [];
  const redirects = {};
  for (let t = 0; t < tokens.length; t += 1) {
    const { op, word } = tokens[t];
    if (op === undefined) {
      argv.push(word);
      continue;
    }
    const target = tokens[t + 1];
    if (!target || target.word === undefined) throw new Error(`no file after ${op}`);
    t += 1;
    if (op === '<') redirects.stdin = target.word;
    else if (op.startsWith('2')) redirects.stderr = { path: target.word, append: op === '2>>' };
    else redirects.stdout = { path: target.word, append: op === '>>' };
  }
  return { argv, redirects };
}

/** The entries of a ustar archive: `{name, type: 'file'|'dir', data}`. */
export function* untar(bytes) {
  const text = (start, length) => {
    let end = start;
    while (end < start + length && bytes[end] !== 0) end += 1;
    return new TextDecoder().decode(bytes.subarray(start, end));
  };
  let longName = null;
  for (let at = 0; at + 512 <= bytes.length; ) {
    if (bytes[at] === 0) break; // the two empty blocks at the end
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(bytes[at + 156] || 48);
    const prefix = text(at + 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${text(at, 100)}` : text(at, 100));
    longName = null;
    const data = bytes.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = new TextDecoder().decode(data).replace(/\0.*$/s, '');
      continue;
    }
    name = name.replace(/^\.\//, '').replace(/\/$/, '');
    if (!name) continue;
    if (type === '5') yield { name, type: 'dir' };
    else if (type === '0' || type === '7') yield { name, type: 'file', data };
    // Links and the rest: the pack has none.
  }
}

function mkdirs(fs, path) {
  let at = '';
  for (const part of path.split('/').filter(Boolean)) {
    at += `/${part}`;
    try {
      fs.mkdir(at);
    } catch {
      // It exists.
    }
  }
}

function removeTree(fs, path) {
  const { mode } = fs.lstat(path);
  if (fs.isDir(mode)) {
    for (const name of fs.readdir(path)) {
      if (name !== '.' && name !== '..') removeTree(fs, `${path}/${name}`);
    }
    fs.rmdir(path);
  } else {
    fs.unlink(path);
  }
}

function resolve(cwd, path) {
  return path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`;
}

function dirname(path) {
  return path.replace(/\/[^/]*$/, '') || '/';
}

function basename(path) {
  return path.replace(/^.*\//, '');
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
