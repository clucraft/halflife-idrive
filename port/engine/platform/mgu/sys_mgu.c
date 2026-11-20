/*
sys_mgu.c - process life on the BMW iDrive 7 head unit (MGU): signals, the service's commands, input, status
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
#include "input.h"
#include "sound.h"
#include "mgu.h"
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <poll.h>
#include <time.h>
#include <ctype.h>
#include <dlfcn.h>
#include <sys/prctl.h>
#include <sys/resource.h>

/*
The engine runs as the child of a service (native/clucraft-halflife in the
halflife-idrive repository). Everything it hears from the outside comes from
that service:

  stdin      one console command a line, with -stdincmds. Besides the engine's
             own commands there are four of ours:
               mgu_key <key> <0|1>          a key or pad button, by the engine's key number
               mgu_axis <axis> <value>      a pad axis, 0..5, -32767..32767
               mgu_touch <0|1|2> <x> <y>    finger down, up, moved; 0..1 across the picture
               mgu_hold <0|1>               stop the main loop, or let it run again
             When stdin ends, the service is gone and the engine quits.
  fd N       with -mgustatus N: one line "MGU {json}" a second, and at once when
             the state changes. The service reads the frame rate from it and
             notices a hang.
  signals    SIGTERM, SIGINT, SIGHUP: quit the ordinary way.

With -mguselftest the program only checks that its libraries load, and leaves.
-mgufps N caps the frame rate (30 unless given), see MGU_Pace.
*/

static struct
{
	qboolean commands;      // stdin is read
	char line[1024];
	size_t len;

	qboolean hold;          // asked for with mgu_hold
	qboolean held;          // the main loop is standing in MGU_Hold
	double skip;            // seconds the last hold took, still to be taken out of the engine's clock

	int status_fd;
	double status_time;
	uint32_t status_frames;
	char status_state[16];

	float touch_x, touch_y;

	long frame_ns;          // the shortest time from one frame's start to the next; 0: no cap
	struct timespec next;   // when the next frame may start
} mgu_sys = { .status_fd = -1 };

/*
A client built without SDL has no handler for SIGTERM and would die without
saving its config or taking its frame file away. The handler here only notes
the signal; the main loop then quits the ordinary way, from Platform_RunEvents.

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
A crash. On the head unit a core dump of a program the crash handler does not
know restarts the whole unit, so three things keep one from being written:
the service's unit has LimitCORE=1, the Store lists this program's name with
the crash handler, and MGU_Harden below makes the process undumpable.

The engine's own handler (a backtrace on stderr, then an attempt to save the
config and close the sound device) still runs first, because the backtrace is
the only thing a crash in the car leaves to look at. It gets three seconds.
Whatever happens in them, the process ends without a dump: a second fault is
fatal at once (the signal is blocked while its handler runs), and the alarm
ends a hang.
*/
static const int mgu_fatal[] = { SIGSEGV, SIGABRT, SIGBUS, SIGILL, SIGFPE };
static struct sigaction mgu_prev[sizeof( mgu_fatal ) / sizeof( mgu_fatal[0] )];

static void MGU_Alarm( int sig )
{
	MGU_RemoveFrameFile();
	_exit( 128 + sig );
}

static void MGU_Fatal( int sig, siginfo_t *si, void *context )
{
	static volatile sig_atomic_t entered;

	if( !entered )
	{
		struct sigaction act = { 0 };

		entered = 1;
		error_on_exit = 128 + sig; // the engine's handler leaves through main()

		act.sa_handler = MGU_Alarm;
		sigemptyset( &act.sa_mask );
		sigaction( SIGALRM, &act, NULL );
		alarm( 3 );

		for( size_t i = 0; i < sizeof( mgu_fatal ) / sizeof( mgu_fatal[0] ); i++ )
		{
			if( mgu_fatal[i] == sig && FBitSet( mgu_prev[i].sa_flags, SA_SIGINFO ) && mgu_prev[i].sa_sigaction )
				mgu_prev[i].sa_sigaction( sig, si, context );
		}
	}

	MGU_RemoveFrameFile();
	_exit( 128 + sig );
}

static void MGU_Harden( void )
{
	// 1, not 0: with a pipe as core_pattern the kernel still starts the handler at 0
	const struct rlimit core = { 1, 1 };

	// Root must never hold the car's sound device (a lock it leaves behind
	// silences other apps until the unit restarts) and has no business here.
	if( geteuid() == 0 || getuid() == 0 )
	{
		static const char msg[] = "MGU: refusing to run as root\n";
		ssize_t unused = write( STDERR_FILENO, msg, sizeof( msg ) - 1 );

		(void)unused;
		_exit( 77 );
	}

	setrlimit( RLIMIT_CORE, &core ); // may fail where the hard limit is 0 already
	prctl( PR_SET_DUMPABLE, 0, 0, 0, 0 );
}

/*
-mguselftest: load every library that ships beside the program, with all of
its symbols resolved, say what happened and leave. The engine library itself
is loaded already when this runs. The service does this once at each start,
so a head unit whose C library or libasound is not what the build expected
shows up as a line in the app, not as a game that will not start.
*/
static void MGU_SelfTest( void )
{
	static const char *const libs[] = { "filesystem_stdio.so", "libref_soft.so", "libmenu.so", "hl_amd64.so", "client_amd64.so" };
	char dir[MAX_SYSPATH], path[MAX_SYSPATH + 32];
	ssize_t len = readlink( "/proc/self/exe", dir, sizeof( dir ) - 1 );
	char *slash;
	int failed = 0;

	dir[len > 0 ? len : 0] = 0;

	if(( slash = Q_strrchr( dir, '/' )) != NULL )
		*slash = 0;

	for( size_t i = 0; i < sizeof( libs ) / sizeof( libs[0] ); i++ )
	{
		Q_snprintf( path, sizeof( path ), "%s/%s", dir, libs[i] );

		if( dlopen( path, RTLD_NOW | RTLD_LOCAL ))
		{
			printf( "MGU selftest: ok %s\n", libs[i] );
		}
		else
		{
			printf( "MGU selftest: FAILED %s\n", dlerror());
			failed++;
		}
	}

	printf( "MGU selftest: %s, %s %s, build %d\n", failed ? "FAILED" : "passed", XASH_ENGINE_NAME, XASH_VERSION, Q_buildnum());
	fflush( stdout );
	_exit( failed ? 1 : 0 );
}

/*
The status line. Never Con_Printf: the service reads these lines as data, and
the log on stdout may be cut anywhere.
*/
static const char *MGU_State( void )
{
	if( mgu_sys.held )
		return "held";

	switch( cls.state )
	{
	case ca_active:
		return cls.key_dest == key_game ? "game" : "paused"; // the menu or the console over the game
	case ca_cinematic:
		return "video";
	case ca_disconnected:
		return "menu";
	default:
		return "loading";
	}
}

static void MGU_Status( qboolean force )
{
	const double now = Platform_DoubleTime();
	const char *state;
	uint32_t frames, width, height, underruns, stands;
	char map[64], buf[384];
	size_t n = 0;
	int len;

	if( mgu_sys.status_fd < 0 )
		return;

	state = MGU_State();

	if( !force && now - mgu_sys.status_time < 1.0 && !Q_strcmp( state, mgu_sys.status_state ))
		return;

	MGU_VideoStats( &frames, &width, &height );

	// a map name goes into JSON as it is: keep to characters that need no escaping
	if( cls.state == ca_active )
	{
		for( const char *p = clgame.mapname; *p && n < sizeof( map ) - 1; p++ )
		{
			if( isalnum( (unsigned char)*p ) || *p == '_' || *p == '-' || *p == '/' || *p == '.' )
				map[n++] = *p;
		}
	}
	map[n] = 0;

	MGU_SoundStats( &underruns, &stands );

	len = Q_snprintf( buf, sizeof( buf ),
		"MGU {\"ev\":\"stat\",\"state\":\"%s\",\"map\":\"%s\",\"fps\":%.1f,\"frames\":%u,\"w\":%u,\"h\":%u,\"sound\":%d,\"underruns\":%u,\"stands\":%u}\n",
		state, map,
		now > mgu_sys.status_time && mgu_sys.status_time > 0.0 ? ( frames - mgu_sys.status_frames ) / ( now - mgu_sys.status_time ) : 0.0,
		frames, width, height, snd.initialized ? 1 : 0, underruns, stands );

	mgu_sys.status_time = now;
	mgu_sys.status_frames = frames;
	Q_strncpy( mgu_sys.status_state, state, sizeof( mgu_sys.status_state ));

	if( len > 0 && write( mgu_sys.status_fd, buf, len ) < 0 && errno != EAGAIN && errno != EINTR )
		mgu_sys.status_fd = -1; // nobody reads it any more
}

/*
Input. The head unit's kernel has no input layer, so nothing here opens a
device: the service passes on what the app got from the iDrive controller and
the touch screen, and what its USB reader got from a gamepad.
*/
static void MGU_Key_f( void )
{
	int key;

	if( Cmd_Argc() != 3 )
		return;

	key = Q_atoi( Cmd_Argv( 1 ));

	if( key > 0 && key < 256 )
		Key_Event( key, Q_atoi( Cmd_Argv( 2 )) != 0 );
}

static void MGU_Axis_f( void )
{
	int axis, value;

	if( Cmd_Argc() != 3 )
		return;

	axis = Q_atoi( Cmd_Argv( 1 ));
	value = Q_atoi( Cmd_Argv( 2 ));

	if( axis >= 0 && axis < MAX_AXES )
		Joy_AxisMotionEvent( (engineAxis_t)axis, (short)bound( -32767, value, 32767 ));
}

static void MGU_Touch_f( void )
{
	int type;
	float x, y, dx = 0.0f, dy = 0.0f;

	if( Cmd_Argc() != 4 )
		return;

	type = Q_atoi( Cmd_Argv( 1 ));
	x = bound( 0.0f, Q_atof( Cmd_Argv( 2 )), 1.0f );
	y = bound( 0.0f, Q_atof( Cmd_Argv( 3 )), 1.0f );

	if( type < event_down || type > event_motion )
		return;

	if( type != event_down )
	{
		dx = x - mgu_sys.touch_x;
		dy = y - mgu_sys.touch_y;
	}

	mgu_sys.touch_x = x;
	mgu_sys.touch_y = y;
	IN_TouchEvent( (touchEventType)type, 0, x, y, dx, dy );
}

static void MGU_Line( const char *line )
{
	// not through the command buffer: nothing executes it while the loop is held
	if( !Q_strncmp( line, "mgu_hold", 8 ) && ( line[8] == ' ' || line[8] == 0 ))
	{
		mgu_sys.hold = Q_atoi( line + 8 ) != 0;
		return;
	}

	Cbuf_AddText( line );
	Cbuf_AddText( "\n" );
}

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
				mgu_sys.line[mgu_sys.len] = 0;
				mgu_sys.len = 0;

				if( mgu_sys.line[0] )
					MGU_Line( mgu_sys.line );
			}
			else if( mgu_sys.len < sizeof( mgu_sys.line ) - 1 )
			{
				mgu_sys.line[mgu_sys.len++] = buf[i];
			}
		}
	}

	// The other end is the service. When it is gone nobody watches the car's
	// speed for us any more, so the game ends with it.
	if( n == 0 || ( n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR ))
	{
		mgu_sys.commands = false;
		mgu_sys.hold = false;

		if( !mgu_signal )
			mgu_signal = SIGHUP;
	}
}

/*
mgu_hold 1 stops the game where it stands: no frame is drawn, no game time
passes and no sound plays, whatever the engine was doing (a menu, a map, a
load). The service asks for it when the car is no longer parked or the app is
not on the screen. Commands that arrive meanwhile wait in the buffer.
*/
static void MGU_Hold( void )
{
	const double start = Platform_DoubleTime();

	mgu_sys.held = true;
	SNDDMA_Activate( false );
	MGU_Status( true );

	while( mgu_sys.hold && !mgu_signal && mgu_sys.commands )
	{
		struct pollfd fd = { .fd = STDIN_FILENO, .events = POLLIN };

		poll( &fd, 1, 100 );
		MGU_ReadCommands();
		MGU_Status( false );
	}

	SNDDMA_Activate( true );
	mgu_sys.held = false;
	mgu_sys.skip += Platform_DoubleTime() - start;
	MGU_Status( true );
}

/*
The frame rate cap. The engine has one of its own (fps_max), but in a single
player game it steps aside whenever gl_vsync is set, expecting the display to
do the limiting, and both are settings a config file or the game's menu can
change. Nothing limits a frame file, and an unlimited software renderer would
keep one of the head unit's four cores at full load for nothing. So the cap is
here, below every setting: the main loop does not start a frame earlier than
1/N s after the one before. 30 unless -mgufps says otherwise (0: no cap).
A timedemo is not capped: it measures.
*/
#define MGU_DEFAULT_FPS 30

static void MGU_Pace( void )
{
	struct timespec now;
	long long late;

	if( mgu_sys.frame_ns <= 0 || cls.timedemo )
		return;

	clock_gettime( CLOCK_MONOTONIC, &now );
	late = ( now.tv_sec - mgu_sys.next.tv_sec ) * 1000000000LL + ( now.tv_nsec - mgu_sys.next.tv_nsec );

	if( late >= 0 )
	{
		// on time or behind. Far behind (a slow frame, a load, a hold): count from now
		if( late > mgu_sys.frame_ns )
			mgu_sys.next = now;
	}
	else
	{
		while( clock_nanosleep( CLOCK_MONOTONIC, TIMER_ABSTIME, &mgu_sys.next, NULL ) == EINTR && !mgu_signal );
	}

	mgu_sys.next.tv_nsec += mgu_sys.frame_ns;

	if( mgu_sys.next.tv_nsec >= 1000000000L )
	{
		mgu_sys.next.tv_nsec -= 1000000000L;
		mgu_sys.next.tv_sec++;
	}
}

void MGU_Init( void )
{
	struct sigaction act = { 0 };
	int fd, wish, fps = MGU_DEFAULT_FPS;

	MGU_Harden();

	if( Sys_CheckParm( "-mguselftest" ))
		MGU_SelfTest();

	act.sa_handler = MGU_Signal;
	sigemptyset( &act.sa_mask );
	sigaction( SIGTERM, &act, NULL );
	sigaction( SIGINT, &act, NULL );
	sigaction( SIGHUP, &act, NULL );

	// the log goes down a pipe to the service; its end must not end us
	signal( SIGPIPE, SIG_IGN );

	// after the engine's own crash handler, which host.c installed before us
	act.sa_handler = NULL;
	act.sa_sigaction = MGU_Fatal;
	act.sa_flags = SA_SIGINFO | SA_ONSTACK;

	for( size_t i = 0; i < sizeof( mgu_fatal ) / sizeof( mgu_fatal[0] ); i++ )
		sigaction( mgu_fatal[i], &act, &mgu_prev[i] );

	if( Sys_CheckParm( "-stdincmds" ) && !isatty( STDIN_FILENO ))
	{
		int flags = fcntl( STDIN_FILENO, F_GETFL );

		if( flags >= 0 && fcntl( STDIN_FILENO, F_SETFL, flags | O_NONBLOCK ) == 0 )
			mgu_sys.commands = true;
	}

	if( Sys_GetIntFromCmdLine( "-mgustatus", &fd ) && fd > STDERR_FILENO )
	{
		int flags = fcntl( fd, F_GETFL );

		// never wait for the reader
		if( flags >= 0 && fcntl( fd, F_SETFL, flags | O_NONBLOCK ) == 0 )
			mgu_sys.status_fd = fd;
	}

	// (the engine's reader clears its result when the argument is not there: the default must survive that)
	if( Sys_GetIntFromCmdLine( "-mgufps", &wish ))
		fps = wish;

	mgu_sys.frame_ns = fps > 0 ? 1000000000L / bound( 5, fps, 120 ) : 0;
	clock_gettime( CLOCK_MONOTONIC, &mgu_sys.next );

	Cmd_AddRestrictedCommand( "mgu_key", MGU_Key_f, "a key or pad button from the service: <key number> <0|1>" );
	Cmd_AddRestrictedCommand( "mgu_axis", MGU_Axis_f, "a pad axis from the service: <axis 0..5> <value>" );
	Cmd_AddRestrictedCommand( "mgu_touch", MGU_Touch_f, "a finger from the service: <0 down|1 up|2 moved> <x 0..1> <y 0..1>" );
}

void MGU_Shutdown( void )
{
}

void Platform_RunEvents( void )
{
	// The frame that follows a hold measures the whole hold as its own length.
	// Taken out here, before the engine adds it: to the game no time passed.
	if( mgu_sys.skip > 0.0 )
	{
		host.realtime -= mgu_sys.skip * sys_timescale.value;
		mgu_sys.skip = 0.0;
	}

	MGU_Pace();

	if( mgu_sys.commands )
		MGU_ReadCommands();

	if( mgu_sys.hold && !mgu_signal )
		MGU_Hold();

	if( mgu_signal )
	{
		string reason;

		Q_snprintf( reason, sizeof( reason ), "caught signal %d", (int)mgu_signal );
		Sys_Quit( reason );
	}

	MGU_Status( false );
}

void Platform_MouseMove( float *x, float *y )
{
	if( x ) *x = 0.0f;
	if( y ) *y = 0.0f;
}

#endif // XASH_MGU
