// node wasm.mjs DIST PROGRAMS OUT
//
// The same as native.sh, with the WebAssembly toolchain in DIST: one toolchain
// for every program, as in a browser tab, /work and /tmp emptied in between.
import { Z88dk } from '../z88dk.mjs';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, programs, out] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const tools = {};
for (const [name, tool] of Object.entries(manifest.tools)) {
  const { default: factory } = await import(pathToFileURL(resolve(dist, tool.js)).href);
  tools[name] = { factory, wasm: readFileSync(join(dist, tool.wasm)) };
}
const z88dk = new Z88dk(tools, { env: manifest.env });
for (const pack of manifest.packs) z88dk.unpack(readFileSync(join(dist, pack.file)), pack.at);

const target = ['+z80', '-vn', '-O3', '-startup=0', '-clib=new'];
for (const file of readdirSync(programs).filter((f) => f.endsWith('.c')).sort()) {
  const dir = join(out, file.replace(/\.c$/, ''));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  z88dk.clear('/work');
  z88dk.clear('/tmp');
  z88dk.writeFile('/work/main.c', readFileSync(join(programs, file)));
  const started = performance.now();
  const build = z88dk.run(['zcc', ...target, '-pragma-define:CRT_ORG_DATA=0xA000',
    '-o', 'main.out', 'main.c', '-lm']);
  const ms = Math.round(performance.now() - started);
  writeFileSync(join(dir, 'status'), `${build.status}\n`);
  writeFileSync(join(dir, 'stdout'), build.stdout ? `${build.stdout}\n` : '');
  writeFileSync(join(dir, 'stderr'), build.stderr ? `${build.stderr}\n` : '');
  for (const name of ['main_CODE.bin', 'main_DATA.bin']) {
    const data = z88dk.readFile(`/work/${name}`);
    if (data) writeFileSync(join(dir, name), data);
  }
  if (build.status === 0) {
    const listing = z88dk.run(['zcc', ...target, '-S', '--c-code-in-asm', '-o', 'main.asm', 'main.c']);
    const asm = z88dk.readFile('/work/main.asm');
    if (listing.status === 0 && asm) writeFileSync(join(dir, 'main.asm'), asm);
  }
  console.log(`${file.padEnd(20)} exit ${build.status} in ${ms} ms`);
}
