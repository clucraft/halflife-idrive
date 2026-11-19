/*
sys_mgu.c - process life on the BMW iDrive 7 head unit (MGU): signals and the event pump
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
#if XASH_MGU
#include "client.h"
#include "mgvf.h"
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>

/*
The engine runs as a service that systemd stops with SIGTERM. A client built
without SDL has no handler for it and would die without saving its config or
taking its frame file away. The handler here only notes the signal; the main
loop then quits the ordinary way, from Platform_RunEvents.

A second signal while the first is still waiting (a long map load, a hang)
ends the process at once: the head unit must get its service slot back.
*/
static volatile sig_atomic_t mgu_signal;

static void MGU_Signal( int sig )
{
	if( mgu_signal )
	{
		MGU_RemoveFrameFile(); // only unlink(): safe in a handler
		_exit( 128 + sig );
	}

	mgu_signal = sig;
}

/*
With -stdincmds, lines arriving on stdin are console commands. A client has
no terminal console, and the service that starts the engine needs a way to
tell it things (pause, quit, load). Off unless asked for, and never on a
terminal.
*/
static struct
{
	qboolean enabled;
	char line[1024];
	size_t len;
} mgu_stdin;

static void MGU_ReadCommands( void )
{
	char buf[256];
	ssize_t n;

	while(( n = read( STDIN_FILENO, buf, sizeof( buf ))) > 0 )
	{
		for( ssize_t i = 0; i < n; i++ )
		{
			if( buf[i] == '\n' )
			{
				mgu_stdin.line[mgu_stdin.len] = 0;
				mgu_stdin.len = 0;

				if( mgu_stdin.line[0] )
				{
					Cbuf_AddText( mgu_stdin.line );
					Cbuf_AddText( "\n" );
				}
			}
			else if( mgu_stdin.len < sizeof( mgu_stdin.line ) - 1 )
			{
				mgu_stdin.line[mgu_stdin.len++] = buf[i];
			}
		}
	}

	// the other end is gone, or stdin broke: stop asking
	if( n == 0 || ( n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR ))
		mgu_stdin.enabled = false;
}

void MGU_Init( void )
{
	struct sigaction act = { 0 };

	act.sa_handler = MGU_Signal;
	sigemptyset( &act.sa_mask );
	sigaction( SIGTERM, &act, NULL );
	sigaction( SIGINT, &act, NULL );
	sigaction( SIGHUP, &act, NULL );

	// the log goes down a pipe to the service manager; its end must not end us
	signal( SIGPIPE, SIG_IGN );

	if( Sys_CheckParm( "-stdincmds" ) && !isatty( STDIN_FILENO ))
	{
		int flags = fcntl( STDIN_FILENO, F_GETFL );

		if( flags >= 0 && fcntl( STDIN_FILENO, F_SETFL, flags | O_NONBLOCK ) == 0 )
			mgu_stdin.enabled = true;
	}
}

void MGU_Shutdown( void )
{
}

void Platform_RunEvents( void )
{
	if( mgu_signal )
	{
		string reason;

		Q_snprintf( reason, sizeof( reason ), "caught signal %d", (int)mgu_signal );
		Sys_Quit( reason );
	}

	if( mgu_stdin.enabled )
		MGU_ReadCommands();
}

void Platform_MouseMove( float *x, float *y )
{
	if( x ) *x = 0.0f;
	if( y ) *y = 0.0f;
}

#endif // XASH_MGU
