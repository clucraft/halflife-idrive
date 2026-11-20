/*
mgu.h - what the parts of the BMW iDrive 7 head unit (MGU) backend know of each other
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
#ifndef MGU_H
#define MGU_H

#include <stdint.h>

// vid_mgu.c: take the frame file away without touching anything else.
// Only unlink(), so a signal handler may call it.
void MGU_RemoveFrameFile( void );

// vid_mgu.c: frames written since the start and the picture's size (0 while
// there is no frame file), for the status line.
void MGU_VideoStats( uint32_t *frames, uint32_t *width, uint32_t *height );

// snd_mgu.c: how often the sound device ran dry, and how often it stood
// (took nothing, as while the car has not connected it to the speakers), for
// the status line.
void MGU_SoundStats( uint32_t *underruns, uint32_t *stands );

#endif // MGU_H
