#!/bin/bash
# Check every program and library under a folder against what the head unit
# has: glibc 2.27, its own libasound, the loader at /lib, and no C++ runtime
# new enough for us. Fails if any file would not load there.
#
#     bash tools/build/check-elf.sh <folder>
set -u

dir=${1:?folder}
max_glibc="2.27"
# Libraries the unit provides. Everything else must be linked in or shipped.
allowed="libc.so.6 libm.so.6 libdl.so.2 libpthread.so.0 librt.so.1 libasound.so.2 ld-linux-x86-64.so.2"
fail=0

newer() { # is version $1 newer than $2?
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]
}

while read -r f; do
  file -b "$f" | grep -q '^ELF' || continue
  name=${f#"$dir"/}
  problems=""

  interp=$(readelf -l "$f" 2>/dev/null | sed -n 's/.*Requesting program interpreter: \(.*\)\]/\1/p')
  if [ -n "$interp" ] && [ "$interp" != "/lib/ld-linux-x86-64.so.2" ]; then
    problems="$problems loader=$interp"
  fi

  # Game libraries may name each other and the engine's own libraries; those ship with us.
  for n in $(readelf -d "$f" 2>/dev/null | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
    case " $allowed " in *" $n "*) continue ;; esac
    if [ -n "$(find "$dir" -name "$n" -print -quit)" ]; then continue; fi
    problems="$problems needs=$n"
  done

  top=$(objdump -T "$f" 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -V | tail -1)
  if [ -n "$top" ] && newer "$top" "$max_glibc"; then
    problems="$problems glibc=$top"
  fi

  if objdump -T "$f" 2>/dev/null | grep -q -E 'GLIBCXX_|CXXABI_'; then
    problems="$problems wants-libstdc++"
  fi

  if [ -n "$problems" ]; then
    echo "FAIL $name:$problems"
    fail=1
  else
    echo "ok   $name (glibc <= ${top:-none}${interp:+, loader $interp})"
  fi
done < <(find "$dir" -type f | sort)

exit $fail
