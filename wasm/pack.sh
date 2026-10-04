#!/bin/sh
# pack.sh Z88DK LIST OUT.tar
#
# Packs the files LIST names (see pack/*.list), from the built z88dk at Z88DK,
# into a tar whose paths start at opt/z88dk/, where z88dk.mjs unpacks it. The
# archive is deterministic: sorted, with fixed owners, modes and times.
set -eu

z88dk=$1
list=$2
out=$3

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

mkdir -p "$staging/opt/z88dk"
grep -v '^\s*\(#\|$\)' "$list" | while read -r pattern; do
    # Globs are expanded relative to the install; a pattern that matches
    # nothing is an error, not a smaller pack.
    found=0
    for path in $(cd "$z88dk" && echo $pattern); do
        [ -e "$z88dk/$path" ] || continue
        found=1
        mkdir -p "$staging/opt/z88dk/$(dirname "$path")"
        cp -R "$z88dk/$path" "$staging/opt/z88dk/$path"
    done
    if [ "$found" = 0 ]; then
        echo "pack.sh: nothing in $z88dk matches $pattern" >&2
        exit 1
    fi
done
find "$staging" -name '*.bak' -delete

(cd "$staging" && find opt -type f | LC_ALL=C sort > files)
tar --format=ustar --owner=0 --group=0 --numeric-owner --mode='u=rw,go=r' \
    --mtime='2000-01-01 00:00:00Z' -C "$staging" -cf "$out" -T "$staging/files"
echo "$out: $(tar -tf "$out" | wc -l | tr -d ' ') files, $(wc -c < "$out" | tr -d ' ') bytes"
