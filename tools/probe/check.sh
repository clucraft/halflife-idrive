#!/bin/bash
# Proves on the PC that the probe batches stay inside the allowlist.
#
# Each batch runs in a BusyBox container whose PATH holds only the ten allowed
# commands, so any other external command fails with "not found" here instead
# of running on the car. Needs Docker (run it inside WSL):
#
#   bash tools/probe/check.sh

set -u
here=$(cd "$(dirname "$0")" && pwd)
allowed="cat ls dmesg zcat grep readlink uname lsmod head hexdump"
fail=0

for f in "$here"/[0-9]*.sh; do
  name=$(basename "$f")
  extra=""
  [ "$name" = "90-free-space.sh" ] && extra="df"
  if grep -q $'\r' "$f"; then echo "FAIL $name: has CR line endings"; fail=1; continue; fi
  if grep -n -E '<<|>[^&/ ]|> *[^&/ d]|>>' "$f" | grep -v '^[0-9]*:#' | grep -v -E '2>&1|2>/dev/null|>/dev/null' | grep -q .; then
    echo "FAIL $name: redirection to something other than /dev/null, or a here-document"; fail=1; continue
  fi
  out=$(sed 's|^PATH=.*|PATH=/allowed|' "$f" |
        docker run --rm -i -e "ALLOWED=$allowed $extra" busybox:1.31 \
          sh -c 'mkdir /allowed; for c in $ALLOWED; do ln -s /bin/busybox "/allowed/$c"; done; PATH=/allowed exec /bin/sh -s' 2>&1)
  bad=$(printf '%s\n' "$out" | grep -E ': not found|syntax error|unknown operand|invalid option|unrecognized option|applet not found|bad substitution')
  sections=$(printf '%s\n' "$out" | grep -c '^=== ')
  if [ -n "$bad" ]; then
    echo "FAIL $name"; printf '%s\n' "$bad" | head -5; fail=1
  else
    echo "ok   $name ($sections sections, $(printf '%s\n' "$out" | wc -l) lines)"
  fi
done
exit $fail
