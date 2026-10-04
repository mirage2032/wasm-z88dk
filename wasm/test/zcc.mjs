// node test/zcc.mjs DIST SOURCE.c OUT [zcc arguments…]
//
// Compiles SOURCE.c with the toolchain in DIST (what `make dist` assembles),
// loaded as the browser worker loads it: its manifest, each tool's module and
// WebAssembly, then the packs. Without arguments it runs the emulator's
// compile: `zcc +z80 -vn -O3 -startup=0 -clib=new
// -pragma-define:CRT_ORG_DATA=0xA000 -o main.out main.c -lm`. Everything left
// in /work is written to OUT, and zcc's exit code is this script's.
import { Z88dk } from '../z88dk.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, source, out, ...args] = process.argv.slice(2);
if (!out) {
  console.error('usage: node test/zcc.mjs DIST SOURCE.c OUT [zcc arguments…]');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const tools = {};
for (const [name, tool] of Object.entries(manifest.tools)) {
  const { default: factory } = await import(pathToFileURL(resolve(dist, tool.js)).href);
  tools[name] = { factory, wasm: readFileSync(join(dist, tool.wasm)) };
}
const z88dk = new Z88dk(tools, { env: manifest.env });
for (const pack of manifest.packs) z88dk.unpack(readFileSync(join(dist, pack.file)), pack.at);

z88dk.writeFile('/work/main.c', readFileSync(source));
const argv = args.length
  ? args
  : ['+z80', '-vn', '-O3', '-startup=0', '-clib=new', '-pragma-define:CRT_ORG_DATA=0xA000',
     '-o', 'main.out', 'main.c', '-lm'];
const started = performance.now();
const result = z88dk.run(['zcc', ...argv]);
const ms = Math.round(performance.now() - started);
if (result.stderr) console.error(result.stderr);
if (result.stdout) console.log(result.stdout);

mkdirSync(out, { recursive: true });
for (const name of z88dk.fs.readdir('/work')) {
  const data = name === '.' || name === '..' ? null : z88dk.readFile(`/work/${name}`);
  if (data) writeFileSync(join(out, name), data);
}
console.error(`zcc exited ${result.status} in ${ms} ms`);
process.exit(result.status);
