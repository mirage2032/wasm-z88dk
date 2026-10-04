/**
 * z88dk in a Web Worker, for a page: it loads the toolchain described by the
 * manifest.json beside it, then runs jobs: files in, commands, files out.
 *
 *   const worker = new Worker(new URL('worker.mjs?v=BUILD', base), { type: 'module' });
 *   worker.postMessage({
 *     id: 1,
 *     clear: ['/work', '/tmp'],
 *     files: { '/work/main.c': source },
 *     run: [['zcc', '+z80', '-o', 'main.out', 'main.c']],
 *     read: ['/work/main_CODE.bin'],
 *   });
 *   // ← { id: 1, results: [{ status, stdout, stderr }], files: { '/work/main_CODE.bin': Uint8Array } }
 *
 * A command is an argv array, or a command line (with redirections) as a
 * string; they run in /work, in order, stopping at the first that fails. A file
 * that wasn't made reads as null. Before the first job's result, `{ id, progress:
 * { loaded, total } }` messages report the download, in bytes, and every job
 * gets `{ id, started: true }` once the toolchain is ready and it begins. A job
 * that can't run at all gets `{ id, error }`.
 *
 * Whatever query the worker's own URL has (`?v=BUILD`) is put on every file it
 * fetches: a page that stamps the worker with a build's fingerprint gets that
 * build's files, so all of them can be cached for good.
 */

const here = new URL(import.meta.url);

/** A file beside this one, with this one's query. */
function beside(name) {
  const url = new URL(name, here);
  url.search = here.search;
  return url.href;
}

const { Z88dk } = await import(beside('z88dk.mjs'));

/** The toolchain, loaded on the first job. */
let toolchain = null;

async function load(report) {
  const manifest = await (await fetchOk(beside('manifest.json'))).json();
  const files = [
    ...Object.values(manifest.tools).map((tool) => tool.wasm),
    ...manifest.packs.map((pack) => pack.file),
  ];
  const total = files.reduce((sum, file) => sum + (manifest.bytes?.[file] ?? 0), 0);
  let loaded = 0;
  const download = async (file) => {
    const bytes = await fetchBytes(beside(file), (chunk) => {
      loaded += chunk;
      report({ loaded: Math.min(loaded, total), total });
    });
    return bytes;
  };

  const tools = {};
  await Promise.all(
    Object.entries(manifest.tools).map(async ([name, tool]) => {
      const [module, wasm] = await Promise.all([import(beside(tool.js)), download(tool.wasm)]);
      tools[name] = { factory: module.default, wasm };
    }),
  );
  const packs = await Promise.all(manifest.packs.map((pack) => download(pack.file)));
  const z88dk = new Z88dk(tools, { env: manifest.env });
  manifest.packs.forEach((pack, i) => z88dk.unpack(packs[i], pack.at ?? '/'));
  return z88dk;
}

self.onmessage = async ({ data: job }) => {
  try {
    toolchain ??= load((progress) => self.postMessage({ id: job.id, progress }));
    let z88dk;
    try {
      z88dk = await toolchain;
    } catch (error) {
      // Not cached: the next job tries again (a network that came back).
      toolchain = null;
      throw error;
    }

    // Loaded: from here on the job takes as long as compiling does.
    self.postMessage({ id: job.id, started: true });
    for (const dir of job.clear ?? []) z88dk.clear(dir);
    for (const [path, content] of Object.entries(job.files ?? {})) z88dk.writeFile(path, content);
    const results = [];
    for (const command of job.run ?? []) {
      const started = performance.now();
      const result =
        typeof command === 'string' ? z88dk.sh(command) : z88dk.run(command);
      results.push({ ...result, ms: Math.round(performance.now() - started) });
      if (result.status !== 0) break;
    }
    const files = {};
    const transfer = [];
    for (const path of job.read ?? []) {
      const data = z88dk.readFile(path);
      files[path] = data && data.slice();
      if (files[path]) transfer.push(files[path].buffer);
    }
    self.postMessage({ id: job.id, results, files }, transfer);
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error?.message ?? error) });
  }
};

async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response;
}

/** A file's bytes, reporting each chunk's size as it arrives. */
async function fetchBytes(url, onChunk) {
  const response = await fetchOk(url);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onChunk(bytes.length);
    return bytes;
  }
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    onChunk(value.length);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
