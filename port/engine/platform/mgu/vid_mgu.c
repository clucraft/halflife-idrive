/*
vid_mgu.c - video for the BMW iDrive 7 head unit (MGU): frames go to a file mgu-render shows
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
#if XASH_VIDEO == VIDEO_MGU
#include "input.h"
#include "client.h"
#include "filesystem.h"
#include "vid_common.h"
#include "mgvf.h"
#include "mgu.h"
#include <fcntl.h>
#include <errno.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/stat.h>

/*
The head unit has no display this process may open: the HMI's compositor
owns the screen. A renderer service (mgu-render) draws for the apps, and it
shows a video from a frame file another process writes, see mgvf.h. So the
engine has no window. The software renderer blits into a buffer of ours,
and every finished frame is converted to I420 into the next slot of the
frame file. Nothing here needs the car, so the same backend runs on a PC
with no screen at all.

Only the software renderer for now. The GL calls are stubs.
*/

#define MGU_DEFAULT_FILE   "/dev/shm/mgu-video-clucraft-halflife"
#define MGU_DEFAULT_WIDTH  1280 // the screen is 1920x720: 8:3
#define MGU_DEFAULT_HEIGHT 480
#define MGU_SLOTS          3

static struct
{
	char path[MAX_SYSPATH];
	int fd;
	mgvf_head_t *head;      // the mapped file; the slots follow the header
	size_t map_size;
	uint width, height;     // of the file's frames
	size_t frame_size;
	unsigned short *rgb;    // what the renderer blits into, RGB565
	uint rgb_width, rgb_height;
	uint32_t *yuv;          // RGB565 -> Y, U << 10, V << 20
	uint frames;
	int window;             // host.hWnd points here: the engine wants a window to exist
} mgu = { .fd = -1 };

static void MGU_BuildTable( void )
{
	if( mgu.yuv )
		return;

	mgu.yuv = Mem_Malloc( host.mempool, 65536 * sizeof( *mgu.yuv ));

	// BT.601, full range
	for( uint p = 0; p < 65536; p++ )
	{
		int r = ( p >> 11 ) & 31, g = ( p >> 5 ) & 63, b = p & 31;

		r = ( r << 3 ) | ( r >> 2 );
		g = ( g << 2 ) | ( g >> 4 );
		b = ( b << 3 ) | ( b >> 2 );

		int y = ( 19595 * r + 38470 * g + 7471 * b + 32768 ) >> 16;
		int u = ( -11059 * r - 21709 * g + 32768 * b + ( 128 << 16 ) + 32768 ) >> 16;
		int v = ( 32768 * r - 27439 * g - 5329 * b + ( 128 << 16 ) + 32768 ) >> 16;

		mgu.yuv[p] = bound( 0, y, 255 ) | bound( 0, u, 255 ) << 10 | bound( 0, v, 255 ) << 20;
	}
}

static void MGU_CloseFile( qboolean remove )
{
	if( mgu.head )
	{
		// a reader that still has the file must not take it for a picture
		__atomic_store_n( &mgu.head->magic, 0, __ATOMIC_RELEASE );
		munmap( mgu.head, mgu.map_size );
		mgu.head = NULL;
	}

	if( mgu.fd >= 0 )
	{
		close( mgu.fd );
		mgu.fd = -1;

		if( remove )
			unlink( mgu.path );
	}

	mgu.map_size = 0;
}

void MGU_RemoveFrameFile( void )
{
	if( mgu.fd >= 0 )
		unlink( mgu.path );
}

void MGU_VideoStats( uint32_t *frames, uint32_t *width, uint32_t *height )
{
	*frames = mgu.frames;
	*width = mgu.fd >= 0 ? mgu.width : 0;
	*height = mgu.fd >= 0 ? mgu.height : 0;
}

static qboolean MGU_OpenFile( uint width, uint height )
{
	const size_t frame_size = (size_t)width * height * 3 / 2;
	const size_t map_size = sizeof( mgvf_head_t ) + frame_size * MGU_SLOTS;
	struct stat st;

	if( map_size > MGVF_APP_LIMIT )
	{
		Con_Printf( S_ERROR "%s: %ux%u needs %zu bytes, the renderer takes %u\n", __func__, width, height, map_size, MGVF_APP_LIMIT );
		return false;
	}

	if( mgu.fd < 0 )
	{
		if( !Sys_GetParmFromCmdLine( "-mgufile", mgu.path ))
		{
			const char *env = getenv( "MGU_VIDEO_FILE" );
			Q_strncpy( mgu.path, COM_StringEmptyOrNULL( env ) ? MGU_DEFAULT_FILE : env, sizeof( mgu.path ));
		}

		// /dev/shm is everybody's: never follow a link, and take only a plain file of our own
		mgu.fd = open( mgu.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600 );

		if( mgu.fd < 0 )
		{
			Con_Printf( S_ERROR "%s: can't open %s: %s\n", __func__, mgu.path, strerror( errno ));
			return false;
		}

		if( fstat( mgu.fd, &st ) < 0 || !S_ISREG( st.st_mode ) || st.st_uid != geteuid( ) || st.st_nlink != 1 )
		{
			Con_Printf( S_ERROR "%s: %s is not a plain file of ours\n", __func__, mgu.path );
			close( mgu.fd );
			mgu.fd = -1;
			return false;
		}
	}
	else if( mgu.head )
	{
		__atomic_store_n( &mgu.head->magic, 0, __ATOMIC_RELEASE );
		munmap( mgu.head, mgu.map_size );
		mgu.head = NULL;
	}

	if( ftruncate( mgu.fd, 0 ) < 0 || ftruncate( mgu.fd, map_size ) < 0 )
	{
		Con_Printf( S_ERROR "%s: can't size %s: %s\n", __func__, mgu.path, strerror( errno ));
		MGU_CloseFile( true );
		return false;
	}

	void *map = mmap( NULL, map_size, PROT_READ | PROT_WRITE, MAP_SHARED, mgu.fd, 0 );

	if( map == MAP_FAILED )
	{
		Con_Printf( S_ERROR "%s: can't map %s: %s\n", __func__, mgu.path, strerror( errno ));
		MGU_CloseFile( true );
		return false;
	}

	mgu.head = map;
	mgu.map_size = map_size;
	mgu.frame_size = frame_size;
	mgu.width = width;
	mgu.height = height;

	// black, not green, until the first frame
	for( uint i = 0; i < MGU_SLOTS; i++ )
	{
		byte *slot = (byte *)( mgu.head + 1 ) + frame_size * i;

		memset( slot, 0, (size_t)width * height );
		memset( slot + (size_t)width * height, 128, frame_size - (size_t)width * height );
	}

	mgu.head->version = MGVF_VERSION;
	mgu.head->w = width;
	mgu.head->h = height;
	mgu.head->seq = 0;
	mgu.head->slot = 0;
	mgu.head->nslot = MGU_SLOTS;
	mgu.head->matrix = MGVF_BT601;
	mgu.head->full = 1;
	mgu.head->format = MGVF_I420;
	__atomic_store_n( &mgu.head->magic, MGVF_MAGIC, __ATOMIC_RELEASE ); // last: now it is a picture

	Con_Reportf( "%s: %s, %ux%u, %u slots\n", __func__, mgu.path, width, height, MGU_SLOTS );
	return true;
}

static void MGU_WriteFrame( void )
{
	const uint w = mgu.width, h = mgu.height;
	const uint32_t *yuv = mgu.yuv;
	const uint next = ( mgu.head->slot + 1 ) % MGU_SLOTS;
	byte *py = (byte *)( mgu.head + 1 ) + mgu.frame_size * next;
	byte *pu = py + (size_t)w * h;
	byte *pv = pu + (size_t)( w / 2 ) * ( h / 2 );

	for( uint y = 0; y < h; y += 2 )
	{
		const unsigned short *s0 = mgu.rgb + (size_t)y * w;
		const unsigned short *s1 = s0 + w;
		byte *y0 = py + (size_t)y * w;
		byte *y1 = y0 + w;

		for( uint x = 0; x < w; x += 2 )
		{
			const uint32_t a = yuv[s0[x]], b = yuv[s0[x + 1]], c = yuv[s1[x]], d = yuv[s1[x + 1]];
			const uint32_t sum = a + b + c + d; // each field has room for four

			y0[x] = a;
			y0[x + 1] = b;
			y1[x] = c;
			y1[x + 1] = d;
			*pu++ = ((( sum >> 10 ) & 1023 ) + 2 ) >> 2;
			*pv++ = ((( sum >> 20 ) & 1023 ) + 2 ) >> 2;
		}
	}

	__atomic_store_n( &mgu.head->slot, next, __ATOMIC_RELEASE );
	__atomic_store_n( &mgu.head->seq, mgu.head->seq + 1, __ATOMIC_RELEASE );
	mgu.frames++;
}

/*
========================
SW_CreateBuffer

The software renderer asks for its target. Sides are made even, as the frame file wants
========================
*/
qboolean SW_CreateBuffer( int width, int height, uint *stride, uint *bpp, uint *r, uint *g, uint *b )
{
	if( width < (int)MGVF_MIN_SIDE || height < (int)MGVF_MIN_SIDE || width > (int)MGVF_MAX_SIDE || height > (int)MGVF_MAX_SIDE || ( width & 1 ) || ( height & 1 ))
	{
		Con_Printf( S_ERROR "%s: %dx%d is not a size the frame file takes\n", __func__, width, height );
		return false;
	}

	MGU_BuildTable();

	if( !MGU_OpenFile( width, height ))
		return false;

	if( mgu.rgb )
		Mem_Free( mgu.rgb );

	mgu.rgb = Mem_Calloc( host.mempool, (size_t)width * height * sizeof( *mgu.rgb ));
	mgu.rgb_width = width;
	mgu.rgb_height = height;

	*stride = width;
	*bpp = 2;
	*r = 0xF800;
	*g = 0x07E0;
	*b = 0x001F;

	return true;
}

void *SW_LockBuffer( void )
{
	return mgu.rgb;
}

void SW_UnlockBuffer( void )
{
	if( mgu.head && mgu.rgb && mgu.rgb_width == mgu.width && mgu.rgb_height == mgu.height )
		MGU_WriteFrame();
}

qboolean R_Init_Video( ref_graphic_apis_t type )
{
	if( type != REF_SOFTWARE )
	{
		Con_Reportf( S_ERROR "%s: only the software renderer has a way to the screen here\n", __func__ );
		return false;
	}

	glw_state.software = true;
	refState.desktopBitsPixel = 16;
	host.hWnd = &mgu.window;

	if( !VID_SetMode( ))
		return false;

	host.renderinfo_changed = false;

	return true;
}

void R_Free_Video( void )
{
	MGU_CloseFile( true );

	if( mgu.rgb )
	{
		Mem_Free( mgu.rgb );
		mgu.rgb = NULL;
	}

	host.hWnd = NULL;

	ref.dllFuncs.GL_ClearExtensions();
}

qboolean VID_SetMode( void )
{
	int width = window_width.value;
	int height = window_height.value;

	SetBits( gl_vsync.flags, FCVAR_CHANGED );

	return R_ChangeDisplaySettings( width, height, WINDOW_MODE_FULLSCREEN ) == rserr_ok;
}

rserr_t R_ChangeDisplaySettings( int width, int height, window_mode_t window_mode )
{
	if( width < VID_MIN_WIDTH || height < VID_MIN_HEIGHT )
	{
		width = MGU_DEFAULT_WIDTH;
		height = MGU_DEFAULT_HEIGHT;
	}

	width = Q_min( width, (int)MGVF_MAX_SIDE ) & ~1;
	height = Q_min( height, (int)MGVF_MAX_SIDE ) & ~1;

	int render_w = width;
	int render_h = height;

	Con_Reportf( "%s: %dx%d\n", __func__, width, height );

	VID_SetDisplayTransform( &render_w, &render_h );
	R_SaveVideoMode( width, height, render_w, render_h, false );
	refState.window_mode = WINDOW_MODE_FULLSCREEN;

	return rserr_ok;
}

int R_MaxVideoModes( void )
{
	return 0;
}

vidmode_t *R_GetVideoMode( int num )
{
	return NULL;
}

void GL_SwapBuffers( void )
{
}

int GL_SetAttribute( int attr, int val )
{
	return 0;
}

int GL_GetAttribute( int attr, int *val )
{
	return 0;
}

void *GL_GetProcAddress( const char *name ) // RenderAPI requirement
{
	return NULL;
}

void GL_UpdateSwapInterval( void )
{
	ClearBits( gl_vsync.flags, FCVAR_CHANGED );
}

ref_window_type_t R_GetWindowHandle( void **handle, ref_window_type_t type )
{
	return REF_WINDOW_TYPE_NULL;
}

void Platform_Minimize_f( void )
{
}

platform_orientation_t Platform_GetDisplayOrientation( void )
{
	return ORIENTATION_UNKNOWN;
}

void VID_Info_f( void )
{
	Con_Printf( "Video: " S_GREEN "MGU frame file" S_DEFAULT " %s, %ux%u I420, %u frames written\n",
		mgu.fd >= 0 ? mgu.path : "(closed)", mgu.width, mgu.height, mgu.frames );
}

#endif // XASH_VIDEO == VIDEO_MGU
