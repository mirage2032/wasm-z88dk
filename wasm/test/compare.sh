#!/bin/bash
# compare.sh NATIVE WASM — what native.sh and wasm.mjs made, program by
# program: exit status, both binaries, zcc's messages, and the listing.
# Temporary file names, the version line and the compile time differ by
# nature, so they're normalised; nothing else is.
native=$1
wasm=$2
norm() { sed -e 's|/tmp/tmp[A-Za-z0-9]*|TMP|g' -e '/^;  Version: /d' -e '/^;	Module compile time: /d' "$1"; }
fail=0
for dir in "$native"/*/; do
    name=$(basename "$dir")
    problems=""
    cmp -s "$native/$name/status" "$wasm/$name/status" || problems+=" status"
    for f in main_CODE.bin main_DATA.bin; do
        if [ -f "$native/$name/$f" ] || [ -f "$wasm/$name/$f" ]; then
            cmp -s "$native/$name/$f" "$wasm/$name/$f" || problems+=" $f"
        fi
    done
    for f in stdout stderr main.asm; do
        if [ -f "$native/$name/$f" ] || [ -f "$wasm/$name/$f" ]; then
            diff -q <(norm "$native/$name/$f") <(norm "$wasm/$name/$f") > /dev/null || problems+=" $f"
        fi
    done
    if [ -n "$problems" ]; then echo "differs  $name:$problems"; fail=1; else echo "same     $name"; fi
done
exit $fail
