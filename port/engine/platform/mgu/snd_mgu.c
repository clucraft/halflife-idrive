/*
snd_mgu.c - sound for the BMW iDrive 7 head unit (MGU): ALSA, on the car's terms
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
#include "platform/platform.h"
#if XASH_SOUND == SOUND_MGU
#include <alsa/asoundlib.h>
#include "sound.h"
#include "mgu.h"

/*
The car's sound goes through SmartXbar, which presents ALSA devices of its own
("plug:smartx:CarLifeMedia_CF_48_STEREO": 48 kHz stereo, S16) and dictates
their buffer: three periods of 1024 frames. The engine's ALSA backend
(platform/linux/s_alsa.c) asks for a period and a buffer of its own choosing
and gives up when the device will not have them, which is what a 48 kHz device
behind a rate converter does to it. This backend asks for nothing it does not
need:

- format and channels, and a rate: the engine's own 44.1 kHz, or the one
  -alsarate names. The buffer and the period are whatever the device gives;
- whenever the device's rate is not the engine's, the sound is converted here
  (linear, good enough for a game). The service asks for 48 kHz, the car's
  own rate, so nothing depends on a rate converter in the car's ALSA setup
  and its periods stay whole;
- the device is kept about 70 ms full, or as full as it gets, from the main
  loop, without ever waiting for it. When the loop was away too long the
  device runs dry and plays silence; it is filled again and that is all;
- while the car has not connected the source to its speakers the device takes
  nothing. The engine's sound clock is this backend's play position, so a
  device that stands would stop it, and every sound the game starts meanwhile
  would wait and then play all at once. So while the device stands, the play
  position is moved on by the clock on the wall and that sound is dropped.

The device is opened by the user the service runs as, never by root: a root
process that opens a SmartXbar stream leaves a lock behind that silences other
apps until the head unit restarts (sys_mgu.c refuses to run as root at all).
*/
#define MGU_SND_DEVICE  "plug:smartx:CarLifeMedia_CF_48_STEREO"
#define MGU_SND_SAMPLES 16384   // the engine's mix buffer in mono samples (a power of two): 186 ms of stereo
#define MGU_SND_FILL    0.070   // seconds of sound kept in the device
#define MGU_SND_STANDS  0.100   // a device that took nothing for this long stands: its sound is dropped
#define MGU_SND_CHUNK   1024    // frames a write

static struct
{
	snd_pcm_t *pcm;
	uint rate;                  // the device's
	snd_pcm_uframes_t buffer;   // its buffer, in frames
	snd_pcm_uframes_t fill;     // how full it is kept
	double step;                // engine frames per device frame
	double phase;               // where the next device frame lies between two engine frames
	qboolean paused;
	double last;                // when SNDDMA_Submit last ran
	snd_pcm_sframes_t held;     // frames in the device after the last write
	double stood;               // seconds the device has taken nothing
	qboolean standing;
	uint32_t underruns, stands;
	short out[MGU_SND_CHUNK * 2];
} mgu_snd;

void MGU_SoundStats( uint32_t *underruns, uint32_t *stands )
{
	*underruns = mgu_snd.underruns;
	*stands = mgu_snd.stands;
}

static void MGU_SndAdvance( uint frames )
{
	snd.samplepos = ( snd.samplepos + frames * 2 ) & ( snd.samples - 1 );
}

/*
n device frames into mgu_snd.out, read from the engine's ring at its play
position without moving it. Straight copies when the rates are the same.
*/
static void MGU_SndConvert( int n )
{
	const short *ring = (const short *)snd.buffer;
	const uint mask = ( snd.samples >> 1 ) - 1; // in frames
	const uint base = snd.samplepos >> 1;
	double pos = mgu_snd.phase;

	for( int i = 0; i < n; i++, pos += mgu_snd.step )
	{
		const uint whole = (uint)pos;
		const int frac = (int)(( pos - whole ) * 256.0 );
		const short *a = &ring[(( base + whole ) & mask ) * 2];
		const short *b = &ring[(( base + whole + 1 ) & mask ) * 2];

		mgu_snd.out[i * 2 + 0] = (short)( a[0] + ((( b[0] - a[0] ) * frac ) >> 8 ));
		mgu_snd.out[i * 2 + 1] = (short)( a[1] + ((( b[1] - a[1] ) * frac ) >> 8 ));
	}
}

/*
Returns NULL, or the name of the step the device refused, with ALSA's error
in *err: on the car that line in the log is all there is to go by.
*/
static const char *MGU_SndParams( snd_pcm_t *pcm, uint *rate, qboolean choose_buffer, int *err )
{
	snd_pcm_hw_params_t *hw;
	snd_pcm_uframes_t frames;

	snd_pcm_hw_params_alloca( &hw );

	if(( *err = snd_pcm_hw_params_any( pcm, hw )) < 0 )
		return "any configuration";

	if(( *err = snd_pcm_hw_params_set_access( pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED )) < 0 )
		return "interleaved writes";

	if(( *err = snd_pcm_hw_params_set_format( pcm, hw, SND_PCM_FORMAT_S16 )) < 0 )
		return "16-bit samples";

	if(( *err = snd_pcm_hw_params_set_channels( pcm, hw, 2 )) < 0 )
		return "two channels";

	if(( *err = snd_pcm_hw_params_set_rate_near( pcm, hw, rate, NULL )) < 0 )
		return "the rate";

	// a wish, where there is a choice: a tenth of a second
	if( choose_buffer )
	{
		frames = *rate / 10;
		snd_pcm_hw_params_set_buffer_size_near( pcm, hw, &frames );
	}

	if(( *err = snd_pcm_hw_params( pcm, hw )) < 0 )
		return "these settings together";

	return NULL;
}

qboolean SNDDMA_Init( void )
{
	string device = MGU_SND_DEVICE;
	snd_pcm_uframes_t period = 0;
	snd_pcm_t *pcm;
	const char *refused;
	uint rate, asked = SOUND_DMA_SPEED;
	int err, wish;

	Sys_GetParmFromCmdLine( "-alsadev", device );

	if( Sys_GetIntFromCmdLine( "-alsarate", &wish ) && wish >= 8000 && wish <= 192000 )
		asked = wish;

	if(( err = snd_pcm_open( &pcm, device, SND_PCM_STREAM_PLAYBACK, SND_PCM_NONBLOCK )) < 0 )
	{
		Con_Printf( S_ERROR "MGU sound: cannot open %s: %s\n", device, snd_strerror( err ));
		return false;
	}

	// first with a buffer of our choosing, then with whatever the device has
	rate = asked;

	if(( refused = MGU_SndParams( pcm, &rate, true, &err )) != NULL )
	{
		rate = asked;
		refused = MGU_SndParams( pcm, &rate, false, &err );
	}

	if( refused )
	{
		Con_Printf( S_ERROR "MGU sound: %s refuses %s at %u Hz: %s\n", device, refused, asked, snd_strerror( err ));
		snd_pcm_close( pcm );
		return false;
	}

	if( snd_pcm_get_params( pcm, &mgu_snd.buffer, &period ) < 0 || mgu_snd.buffer == 0 || rate < 8000 || rate > 192000 )
	{
		Con_Printf( S_ERROR "MGU sound: %s has no usable buffer\n", device );
		snd_pcm_close( pcm );
		return false;
	}

	mgu_snd.pcm = pcm;
	mgu_snd.rate = rate;
	mgu_snd.step = (double)SOUND_DMA_SPEED / rate;
	mgu_snd.phase = 0.0;
	mgu_snd.fill = Q_min( mgu_snd.buffer, (snd_pcm_uframes_t)( rate * MGU_SND_FILL ));
	mgu_snd.paused = false;
	mgu_snd.last = Platform_DoubleTime();
	mgu_snd.held = 0;
	mgu_snd.stood = 0.0;
	mgu_snd.standing = false;

	snd.format.speed = SOUND_DMA_SPEED;
	snd.format.channels = 2;
	snd.format.width = 2;
	snd.samples = MGU_SND_SAMPLES;
	snd.samplepos = 0;
	snd.buffer = Mem_Calloc( sndpool, snd.samples * snd.format.width );
	snd.initialized = true;
	snd.backend_name = "MGU ALSA";

	snd_pcm_prepare( pcm );

	Con_Printf( "MGU sound: %s at %u Hz%s, buffer %lu frames in periods of %lu, kept %lu full\n", device, rate,
		rate == SOUND_DMA_SPEED ? "" : " (converted here from 44100)", (unsigned long)mgu_snd.buffer, (unsigned long)period, (unsigned long)mgu_snd.fill );

	return true;
}

void SNDDMA_Shutdown( void )
{
	Con_Printf( "Shutting down audio.\n" );
	snd.initialized = false;

	// closed here, before the process ends: a stream left open at a kill can leave the car's input busy
	if( mgu_snd.pcm )
	{
		snd_pcm_drop( mgu_snd.pcm );
		snd_pcm_close( mgu_snd.pcm );
		mgu_snd.pcm = NULL;
	}

	if( snd.buffer )
	{
		Mem_Free( snd.buffer );
		snd.buffer = NULL;
	}
}

void SNDDMA_Submit( void )
{
	const double now = Platform_DoubleTime();
	const double elapsed = bound( 0.0, now - mgu_snd.last, 0.5 );
	snd_pcm_sframes_t avail, filled, want;
	qboolean dry = false;

	mgu_snd.last = now;

	if( !mgu_snd.pcm || !snd.buffer || mgu_snd.paused )
		return;

	avail = snd_pcm_avail_update( mgu_snd.pcm );

	if( avail < 0 )
	{
		// it ran dry (the main loop was away too long), or the stream was suspended
		mgu_snd.underruns++;
		dry = true;

		if( snd_pcm_recover( mgu_snd.pcm, (int)avail, 1 ) < 0 )
			snd_pcm_prepare( mgu_snd.pcm );

		avail = snd_pcm_avail_update( mgu_snd.pcm );
	}

	if( avail < 0 )
		avail = 0; // still broken: a device that takes nothing

	if( avail > (snd_pcm_sframes_t)mgu_snd.buffer )
		avail = mgu_snd.buffer;

	filled = (snd_pcm_sframes_t)mgu_snd.buffer - avail;

	// Did it play anything since the last write? If not for a while, it stands
	// (the route to the speakers is not connected): time goes on without it.
	if( dry || filled < mgu_snd.held )
	{
		mgu_snd.stood = 0.0;
		mgu_snd.standing = false;
	}
	else if(( mgu_snd.stood += elapsed ) > MGU_SND_STANDS )
	{
		if( !mgu_snd.standing )
		{
			mgu_snd.standing = true;
			mgu_snd.stands++;
		}

		MGU_SndAdvance( (uint)( elapsed * SOUND_DMA_SPEED ));
	}

	want = (snd_pcm_sframes_t)mgu_snd.fill - filled;

	if( want > avail )
		want = avail;

	while( want > 0 )
	{
		const int n = (int)Q_min( want, (snd_pcm_sframes_t)MGU_SND_CHUNK );
		snd_pcm_sframes_t wrote;
		double pos;
		uint whole;

		MGU_SndConvert( n );
		wrote = snd_pcm_writei( mgu_snd.pcm, mgu_snd.out, n );

		if( wrote <= 0 )
			break; // no room after all; a real error shows as avail < 0 next time

		pos = mgu_snd.phase + wrote * mgu_snd.step;
		whole = (uint)pos;
		mgu_snd.phase = pos - whole;
		MGU_SndAdvance( whole );
		filled += wrote;
		want -= wrote;

		if( wrote < n )
			break;
	}

	mgu_snd.held = filled;
}

void SNDDMA_BeginPainting( void )
{
}

/*
Called with false when the game is held (sys_mgu.c) and with true when it
goes on: what is in the device is thrown away, so nothing plays into a pause.
*/
void SNDDMA_Activate( qboolean active )
{
	if( !mgu_snd.pcm || mgu_snd.paused == !active )
		return;

	mgu_snd.paused = !active;

	if( mgu_snd.paused )
	{
		snd_pcm_drop( mgu_snd.pcm );
	}
	else
	{
		snd_pcm_prepare( mgu_snd.pcm );
		mgu_snd.last = Platform_DoubleTime();
		mgu_snd.held = 0;
		mgu_snd.stood = 0.0;
		mgu_snd.standing = false;
	}
}

qboolean VoiceCapture_Init( void )
{
	return false;
}

qboolean VoiceCapture_Activate( qboolean activate )
{
	return false;
}

qboolean VoiceCapture_Lock( qboolean lock )
{
	return false;
}

void VoiceCapture_Shutdown( void )
{
}

#endif // XASH_SOUND == SOUND_MGU
