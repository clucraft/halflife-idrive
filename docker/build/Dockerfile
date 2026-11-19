# Build and test image: Ubuntu 18.04 has glibc 2.27, the head unit's version,
# so nothing built here can ask for a newer C library than the car has.
FROM ubuntu:18.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential python3 git ca-certificates pkg-config cmake \
      libasound2-dev binutils file \
 && rm -rf /var/lib/apt/lists/*

# The head unit has its loader only at /lib/ld-linux-x86-64.so.2 and our
# binaries name that path. Ubuntu keeps it under /lib64, so give the
# container the same name; otherwise nothing built here could run here.
RUN [ -e /lib/ld-linux-x86-64.so.2 ] || ln -s /lib64/ld-linux-x86-64.so.2 /lib/ld-linux-x86-64.so.2
