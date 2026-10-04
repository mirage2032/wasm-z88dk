// node test/zcc.mjs SOURCE.c [zcc arguments…]
// Compiles SOURCE.c with the WebAssembly toolchain in build/, as the emulator
// does, and writes what it made to build/test-out/.
import { Z88dk } from '../z88dk.mjs';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const bin = new URL('../build/bin/', import.meta.url);
const names = ['zcc', 'z88dk-ucpp', 'z88dk-zpragma', 'z88dk-sccz80', 'z88dk-copt', 'z88dk-z80asm', 'm4'];
const tools = {};
for (const name of names) {
  const wasm = new URL(`${name}.wasm`, bin);
  if (!existsSync(wasm)) {
    console.warn(`(no ${name})`);
    continue;
  }
  const { default: factory } = await import(new URL(`${name}.mjs`, bin));
  tools[name] = { factory, wasm: readFileSync(wasm) };
}

const z = new Z88dk(tools, {
  env: { ZCCCFG: '/opt/z88dk/lib/config/', Z88DK_PATH: '/opt/z88dk', PATH: '/opt/z88dk/bin' },
});
const files = z.unpack(readFileSync(new URL('../build/z80-newlib.tar', import.meta.url)));
const [source, ...extra] = process.argv.slice(2);
z.writeFile('/work/main.c', readFileSync(source));
const args = extra.length ? extra : ['+z80', '-vn', '-O3', '-startup=0', '-clib=new',
  '-pragma-define:CRT_ORG_DATA=0xA000', '-o', 'main.out', 'main.c', '-lm'];
const started = performance.now();
const result = z.run(['zcc', ...args]);
console.log(`unpacked ${files} files; zcc exited ${result.status} in ${Math.round(performance.now() - started)} ms`);
if (result.stdout) console.log(`stdout:\n${result.stdout}`);
if (result.stderr) console.log(`stderr:\n${result.stderr}`);
const out = new URL('../build/test-out/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const name of z.fs.readdir('/work')) {
  if (name === '.' || name === '..') continue;
  const data = z.readFile(`/work/${name}`);
  if (data) writeFileSync(new URL(name, out), data);
  console.log(`  ${name} ${data ? data.length : '(dir)'}`);
}
