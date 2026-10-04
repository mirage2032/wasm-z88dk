# z88dk for WebAssembly

z88dk's C compiler, running in a browser: `zcc` and the tools it drives, compiled to WebAssembly with
[Emscripten](https://emscripten.org), driven from a Web Worker. Nothing is compiled on a server, and
the output is byte for byte what a native z88dk of the same commit makes (`make check` proves it).

What's built is what `zcc +z80 -clib=new` (sccz80, the new C library, `-lm`) needs:

| Tool | From | What it does |
| --- | --- | --- |
| `zcc` | `src/zcc` | the driver: runs the others with `system()` |
| `z88dk-ucpp` | `src/ucpp` | C preprocessor |
| `z88dk-zpragma` | `src/zpragma` | `#pragma`s → `zcc_opt.def` |
| `z88dk-sccz80` | `src/sccz80` | the C compiler |
| `z88dk-copt` | `src/copt` | peephole optimiser |
| `z88dk-z80asm` | `src/z80asm` | assembler and linker |
| `m4` | GNU m4 1.4.19 | generates the start-up code |
| `astyle` | Artistic Style 3.6.19 | formats C (not part of z88dk; for editors) |

plus a data pack with the libraries, headers and start-up code those read (`pack/z80-newlib.list`).
Other targets and libraries are another pack list. Not built: `appmake` (it needs GMP; `-create-app`
isn't needed for `_CODE.bin`/`_DATA.bin`), zsdcc and the other tools.

## How it runs

zcc is a driver: it writes temporary files and starts the real tools on them with `system()`, and
they talk only through files and exit codes. The port keeps that design rather than merging the
tools into one program (their globals assume a fresh process every run, and copt runs four times a
compile):

- **A process is a fresh instance.** Each tool is an Emscripten ES module whose factory runs `main()`
  synchronously (`-sWASM_ASYNC_COMPILATION=0`), so instantiating it is starting a process, and its
  exit code is known when the factory returns. `-sEXIT_RUNTIME=1` makes exiting flush and close
  files, as natively.
- **One filesystem.** Files live in a root filesystem held by `z88dk.mjs`; each process sees the
  shared directories (`/opt`, where the pack unpacks to `/opt/z88dk`, `/tmp` and `/work`) as
  [PROXYFS](https://emscripten.org/docs/api_reference/Filesystem-API.html) mounts of it, so what one
  tool writes the next reads. Each process's own `/dev` and `/proc` stay its own.
- **A small shell.** zcc's `system()` reaches JavaScript (`system.js`, Emscripten's
  `_emscripten_system` hook) as a command line; `z88dk.mjs` splits it as sh would (quotes, `<`,
  `>`, `>>`, `2>`), runs the tool named — synchronously, inside zcc's call — and returns its wait
  status. `cat`, which zcc uses to join files, is built in. Pipes and the like are refused: zcc
  never writes them.
- **Compiled once.** Each tool's WebAssembly is compiled the first time it runs and reused after
  (`start()` in `z88dk.mjs`), which makes a compile about three times faster in Chrome.

One build step reshapes code without changing it: z80asm's parser (ragel's
`src/z80asm/src/c/parse_rules.h`) has a `switch` of ~15,800 actions in one function. In
WebAssembly that's a single 900 KB function, and once it is hot V8's optimising compiler runs out of
memory on it — *Fatal process out of memory: Zone*, which kills the page. `parse_actions.mjs`
moves the 15,600 actions that only call a `cpu_rules_action_*()` into a table dispatched from the
switch's `default:`; the parser does exactly the same. `--no-liftoff` (everything through the
optimising compiler) is the test for it.

Every other change is in the build flags: no source file under `src/` is modified.

## Building

Needs [emsdk](https://emscripten.org/docs/getting_started/downloads.html) 6.0.11 (`emcc` on the
`PATH`; its Node runs the scripts), GNU make, curl, tar, xz, bzip2 and sha256sum. The libraries are
built by running z88dk itself, so they come from a native build of the same commit; z88dk's Docker
images have one in `/opt/z88dk`:

```bash
make -j"$(nproc)"                      # the tools, in build/bin
make dist Z88DK=/path/to/native/z88dk  # + the pack, in build/dist: what a page serves
```

`build/dist` holds, flat: `worker.mjs`, `z88dk.mjs`, each tool's `.mjs` and `.wasm`, the pack, and
`manifest.json` listing them with their sizes and SHA-256s; also `NOTICE.txt` (the licences) and m4's
source tarball, which serving m4's binary obliges you to serve too (GPL-3.0). About 12 MB, 2.4 MB
compressed; z80asm is most of it.

## Using it

In a page, start `worker.mjs` as a module worker and post it jobs; it loads everything on the first
one. `worker.mjs` documents the messages.

```js
const worker = new Worker('/z88dk/worker.mjs?v=BUILD', { type: 'module' });
worker.postMessage({
  id: 1,
  clear: ['/work', '/tmp'],
  files: { '/work/main.c': source },
  run: [['zcc', '+z80', '-startup=0', '-clib=new', '-o', 'main.out', 'main.c', '-lm']],
  read: ['/work/main_CODE.bin', '/work/main_DATA.bin'],
});
// ← { id: 1, progress: { loaded, total } } … { id: 1, started: true }
// ← { id: 1, results: [{ status, stdout, stderr, ms }], files: { '/work/main_CODE.bin': Uint8Array, … } }
```

Whatever query the worker's URL has is put on everything it fetches, so a page that stamps it with a
build's fingerprint can cache all of it for good. Synchronous compilation of large modules is only
allowed in workers, so the toolchain can't run on a page's main thread. To stop a runaway compile,
terminate the worker.

`z88dk.mjs` runs anywhere with WebAssembly, Node included: `new Z88dk(tools, { env })`, then
`unpack(tar)`, `writeFile`, `run(argv)` or `sh(commandLine)`, `readFile`. `test/zcc.mjs` is a
complete example.

## Testing

```bash
node test/zcc.mjs build/dist program.c out/        # compile one program
make check Z88DK=/path/to/native/z88dk Z88DK_IMAGE=z88dk/z88dk@sha256:…
```

`make check` compiles every `test/programs/*.c` with the native z88dk image and with `build/dist`,
then compares the exit status, both binaries, every message and the `-S` listing of each (only the
version line, the compile time and temporary file names may differ). The programs cover errors on
lines, link errors, warnings, programs too big for a 64 KB map, floats and `-lm`, the C library,
`#pragma`s that change the start-up code, inline assembly and UTF-8 source.

## Updating z88dk

Merge or rebase onto a newer z88dk, build the tools, and rebuild the pack from a native build of the
*same* commit (the libraries' object format follows z80asm's), then `make check` against that
commit's image. If ragel's output changes shape, `parse_actions.mjs` stops the build rather than
guessing.
