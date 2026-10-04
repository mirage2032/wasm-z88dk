// node parse_actions.mjs IN/parse_rules.h OUT/parse_rules.h
//
// z80asm's parser (src/z80asm/src/c/parse_rules.h, generated with ragel) runs
// every action through one switch, and all but a couple of hundred of its
// ~15,800 cases do the same thing: call one of cpu_rules_action.c's functions.
// Compiled to WebAssembly that makes parse_statement() a single function of
// almost 900 KB, and once it's hot, V8's optimising compiler runs out of
// memory on it ("Fatal process out of memory: Zone"), which takes the whole
// page down with it.
//
// So this moves those cases into a table of function pointers, dispatched from
// the switch's `default:`. The parser does exactly what it did, action for
// action; only the shape of its code changes. The build compiles a copy of
// parse1.c next to the result, so the original files are left alone.
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const source = readFileSync(input, 'utf8');

const head = 'switch ( *_acts++ ) {';
if (source.split(head).length !== 2) {
  throw new Error(`${input}: expected one "${head}", the actions' switch`);
}
const start = source.indexOf(head);
// The switch's own closing brace.
let depth = 0;
let end = start + head.length - 1;
for (; end < source.length; end += 1) {
  if (source[end] === '{') depth += 1;
  else if (source[end] === '}' && --depth === 0) break;
}
const body = source.slice(start + head.length, end);

// `case N: { if (!cpu_rules_action_K(ctx, name, stmt_label)) { return false; } } break;`
const simple =
  /\n[ \t]*case (\d+): \{\s*if \(!(cpu_rules_action_\d+)\(ctx, name, stmt_label\)\) \{\s*return false;\s*\}\s*\}\s*break;/g;
const table = [];
const rest = body.replace(simple, (_, action, fn) => {
  table.push([Number(action), fn]);
  return '';
});
if (table.length < 1000 || hasOwnDefault(rest)) {
  throw new Error(`${input}: the actions' switch isn't the shape this expects (${table.length} calls)`);
}

/** Whether the switch body has a `default:` of its own (not a nested switch's). */
function hasOwnDefault(text) {
  let level = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') level += 1;
    else if (text[i] === '}') level -= 1;
    else if (level === 0 && /^default\s*:/.test(text.slice(i, i + 16))) return true;
  }
  return false;
}

table.sort((a, b) => a[0] - b[0]);
const size = table[table.length - 1][0] + 1;
const declarations = [
  '/* parse_actions.mjs: the actions that only call a cpu_rules_action_*() */',
  'typedef bool (*parse_action_fn)(ParseCtx* ctx, Str* name, Str* stmt_label);',
  `static const parse_action_fn parse_action_table[${size}] = {`,
  ...table.map(([action, fn]) => `    [${action}] = ${fn},`),
  '};',
  '',
].join('\n');
const dispatch = `
                default: {
                    short action = _acts[-1];
                    if (action >= 0 && action < ${size} && parse_action_table[action]
                            && !parse_action_table[action](ctx, name, stmt_label)) {
                        return false;
                    }
                }
                break;
                `;
writeFileSync(
  output,
  declarations + source.slice(0, start + head.length) + rest + dispatch + source.slice(end),
);
console.log(`${output}: ${table.length} of the parser's actions dispatched from a table`);
