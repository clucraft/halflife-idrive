/*
mgvf.h - the frame file mgu-render shows as a video ("MGVF")
Copyright (C) 2026 the halflife-idrive authors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
*/
#ifndef MGVF_H
#define MGVF_H

#include <stdint.h>

/*
The format is mgu-render's (struct mgu_video_head in its src/proto.h):

A file /dev/shm/mgu-video-<name> holds this header and then nslot frames
of w * h * 3 / 2 bytes each, rows without padding. The writer fills slot
(slot + 1) % nslot, then stores slot, then seq + 1. The renderer reads
seq and slot, then that slot. With three slots the writer is two frames
away from the one being read, so nobody takes a lock.
*/
#define MGVF_MAGIC       0x4656474du // "MGVF"
#define MGVF_VERSION     1u
#define MGVF_MIN_SIDE    16u
#define MGVF_MAX_SIDE    2048u
#define MGVF_MAX_SLOTS   4u
#define MGVF_APP_LIMIT   ( 12u << 20 ) // the renderer's limit on one app's frame files

enum
{
	MGVF_I420 = 0, // the Y plane, then U, then V
	MGVF_NV12 = 1, // the Y plane, then one plane of U V pairs; only where the renderer offers it
};

enum
{
	MGVF_BT601 = 0,
	MGVF_BT709 = 1,
};

typedef struct mgvf_head_s
{
	uint32_t magic, version;    // MGVF_MAGIC, MGVF_VERSION
	uint32_t w, h;              // even, MGVF_MIN_SIDE..MGVF_MAX_SIDE
	uint32_t seq, slot, nslot;  // frames written so far, the newest one's slot, slots (1..4)
	uint32_t matrix, full;      // MGVF_BT601 or MGVF_BT709; 0 limited (16-235), 1 full range
	uint32_t format;            // MGVF_I420 or MGVF_NV12
	uint32_t pad[6];            // 64 bytes in all
} mgvf_head_t;

// vid_mgu.c: take the frame file away without touching anything else.
// Only unlink(), so a signal handler may call it.
void MGU_RemoveFrameFile( void );

#endif // MGVF_H
