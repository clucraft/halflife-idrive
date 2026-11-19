#!/bin/sh
# Free space per filesystem.
# Read-only, but it uses df, which is NOT on the ten-command list: needs the owner's OK first.
# Run: ssh <head-unit> sh -s < tools/probe/90-free-space.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin

echo "=== free-space ==="
df -h
echo "=== inodes ==="
df -i
