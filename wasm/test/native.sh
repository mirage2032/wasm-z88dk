#!/bin/sh
# native.sh PROGRAMS OUT — run inside a native z88dk (its Docker image):
# compiles every PROGRAMS/*.c as the emulator does, into OUT/<name>/: zcc's
# exit status and output, the binaries, and the -S listing.
set -u
programs=$1
out=$2
for src in "$programs"/*.c; do
    name=$(basename "$src" .c)
    dir=$out/$name
    rm -rf "$dir" && mkdir -p "$dir"
    work=$(mktemp -d) && cp "$src" "$work/main.c" && cd "$work" || exit 1
    zcc +z80 -vn -O3 -startup=0 -clib=new -pragma-define:CRT_ORG_DATA=0xA000 \
        -o main.out main.c -lm > "$dir/stdout" 2> "$dir/stderr"
    echo $? > "$dir/status"
    for f in main_CODE.bin main_DATA.bin; do [ -f "$f" ] && cp "$f" "$dir/"; done
    if [ "$(cat "$dir/status")" = 0 ]; then
        zcc +z80 -vn -O3 -startup=0 -clib=new -S --c-code-in-asm -o main.asm main.c \
            > /dev/null 2>&1 && cp main.asm "$dir/"
    fi
    cd / && rm -rf "$work"
done
