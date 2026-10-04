// node test/limits.mjs DIST
//
// Programs that never finish compiling natively must still stop here, quickly
// and with a reason: an endless macro expansion is stopped by the largest-file
// limit, and an include of an endless device fails at once.
import { Z88dk } from '../z88dk.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const tools = {};
for (const [name, tool] of Object.entries(manifest.tools)) {
  const { default: factory } = await import(pathToFileURL(resolve(dist, tool.js)).href);
  tools[name] = { factory, wasm: readFileSync(join(dist, tool.wasm)) };
}
const z88dk = new Z88dk(tools, { env: manifest.env });
for (const pack of manifest.packs) z88dk.unpack(readFileSync(join(dist, pack.file)), pack.at);

const doubling = ['#define X0 1'];
for (let i = 1; i < 40; i += 1) doubling.push(`#define X${i} X${i - 1}+X${i - 1}`);
const cases = [
  ['an endless macro expansion', `${doubling.join('\n')}\nint main(void) { return X39; }\n`, /File too large/],
  ['an endless device', '#include "/dev/urandom"\nint main(void) { return 0; }\n', /error/],
  ['an include of itself', '#include "main.c"\nint main(void) { return 0; }\n', /included from/],
];
let failed = false;
for (const [what, source, expected] of cases) {
  z88dk.clear('/work');
  z88dk.clear('/tmp');
  z88dk.writeFile('/work/main.c', source);
  const started = performance.now();
  const result = z88dk.run(['zcc', '+z80', '-vn', '-O3', '-startup=0', '-clib=new', '-o', 'main.out', 'main.c']);
  const seconds = (performance.now() - started) / 1000;
  const ok = result.status !== 0 && expected.test(result.stderr) && seconds < 20;
  failed ||= !ok;
  console.log(`${ok ? 'stops' : 'FAILS'}  ${what}: exit ${result.status} after ${seconds.toFixed(1)} s`);
}
process.exit(failed ? 1 : 0);
