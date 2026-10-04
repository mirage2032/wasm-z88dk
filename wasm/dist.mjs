// node dist.mjs BIN PACKS OUT TOOL...
//
// Assembles what a page serves: the worker, z88dk.mjs, each tool's module and
// WebAssembly, and the data packs, flat in OUT, with the manifest.json the
// worker reads. TOOL names come from BIN (`zcc` for BIN/zcc.mjs and
// BIN/zcc.wasm); PACKS is a directory of .tar files, unpacked at /.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [bin, packs, out, ...names] = process.argv.slice(2);
if (!names.length) {
  console.error('usage: node dist.mjs BIN PACKS OUT TOOL...');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const here = new URL('.', import.meta.url).pathname;
// Every file's size, for the worker's progress, and hash, so a page can tell
// one build from another by the manifest alone.
const bytes = {};
const sha256 = {};
const copy = (from) => {
  const name = basename(from);
  copyFileSync(from, join(out, name));
  const data = readFileSync(from);
  bytes[name] = data.length;
  sha256[name] = createHash('sha256').update(data).digest('hex');
  return name;
};

copy(join(here, 'worker.mjs'));
copy(join(here, 'z88dk.mjs'));
const tools = {};
for (const name of names) {
  tools[name] = { js: copy(join(bin, `${name}.mjs`)), wasm: copy(join(bin, `${name}.wasm`)) };
}
const packList = readdirSync(packs)
  .filter((file) => file.endsWith('.tar'))
  .sort()
  .map((file) => ({ file: copy(join(packs, file)), at: '/' }));

const manifest = {
  // Every process gets this environment: where zcc finds its configuration.
  env: { ZCCCFG: '/opt/z88dk/lib/config/', Z88DK_PATH: '/opt/z88dk', PATH: '/opt/z88dk/bin' },
  tools,
  packs: packList,
  bytes,
  sha256,
};
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const total = Object.values(bytes).reduce((sum, size) => sum + size, 0);
console.log(`${out}: ${Object.keys(bytes).length + 1} files, ${total} bytes`);
