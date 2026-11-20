# Test image: the build image plus what the service needs to run on the PC.
#
#   nodejs      Ubuntu 18.04's is Node 8.10; the head unit's is 8.16. Old
#               enough to catch syntax the car's Node does not have.
#   pulseaudio  a sound device with a clock and no speakers: a 48 kHz null
#               sink behind an ALSA name, so the engine's ALSA code plays in
#               real time and what it played can be recorded and checked.
FROM halflife-idrive-build:bionic

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nodejs pulseaudio pulseaudio-utils libasound2-plugins \
 && rm -rf /var/lib/apt/lists/*
