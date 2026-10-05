import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { admitCommand, hostPriorityPrefix, resolveTier, type SandboxTier } from './host-load.js';
import { overlayArgv, prepareOverlays } from './overlay.js';
import { inside, type SandboxLayout } from './sandbox-layout.js';

export { sandboxLayout, type SandboxLayout } from './sandbox-layout.js';

export interface RunOptions {
	network?: boolean;
	/** Counted from when the command starts, after any wait for a free slot; a function is read at that moment. */
	timeoutMs: number | (() => number);
	/** `prep` for the dependency install and baseline checks; the default is `run`. */
	tier?: SandboxTier;
	signal?: AbortSignal;
	stdin?: string;
}

export interface RunResult {
	exitCode: number | null;
	output: string;
	truncated: boolean;
	timedOut: boolean;
	elapsedMs: number;
}

/** Where /etc/resolv.conf really lives when it is a link, since a hidden dir can swallow the target. */
function resolvConfTarget(): string | null {
	try {
		const target = realpathSync('/etc/resolv.conf');

		return target === '/etc/resolv.conf' ? null : target;
	} catch {
		return null;
	}
}

/**
 * bubblewrap arguments for one command: a read-only host with the layout's
 * hidden dirs emptied (a fresh /tmp already covers its children), toolchains
 * bound back, the checkout and cache writable with `.git` read-only so HEAD
 * cannot move, a cleared environment and fresh namespaces. The networked
 * install also gets its DNS config back: systemd-resolved's stub under /run,
 * and the file /etc/resolv.conf links to (WSL keeps it under /mnt). stderr
 * joins stdout so the agent sees output in the order it was written.
 */
function bwrapArgs(layout: SandboxLayout, command: string, opts: { network?: boolean } = {}): string[] {
	const args = ['--die-with-parent', '--new-session', '--unshare-all'];

	if (layout.overlays.length) args.push('--uid', String(process.getuid!()), '--gid', String(process.getgid!()));
	if (opts.network) args.push('--share-net');
	args.push('--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--dir', '/tmp/home');

	for (const dir of layout.hidden) {
		if (!inside(dir, '/tmp')) args.push('--tmpfs', dir);
	}

	if (opts.network) {
		args.push('--ro-bind-try', '/run/systemd/resolve', '/run/systemd/resolve');

		const resolver = resolvConfTarget();

		if (resolver) args.push('--ro-bind-try', resolver, resolver);
	}

	for (const dir of [...layout.toolchains, ...(layout.readOnly ?? [])]) args.push('--ro-bind', dir, dir);
	for (const file of layout.masked) args.push('--ro-bind', '/dev/null', file);
	args.push('--bind', layout.checkout, layout.checkout);

	const git = join(layout.checkout, '.git');

	if (existsSync(git)) args.push('--ro-bind', git, git);
	args.push('--bind', layout.cacheDir, layout.cacheDir, '--chdir', layout.checkout, '--clearenv');
	for (const [key, value] of Object.entries(layout.env)) args.push('--setenv', key, value);
	args.push('--', shell(), '-c', 'eval "$1" 2>&1', 'recoder', command);

	return args;
}

/** SBPL string literal. */
function sbpl(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Every parent directory of these paths, `/` included. Path walks (mkdir -p,
 * realpath) stat each parent of what's allowed; that reveals nothing, while
 * listing or reading those parents stays denied.
 */
function ancestors(paths: string[]): string[] {
	const out = new Set<string>();

	for (const path of paths) {
		for (let dir = dirname(path); ; dir = dirname(dir)) {
			out.add(dir);
			if (dir === dirname(dir)) break;
		}
	}

	return [...out].sort();
}

/**
 * The Seatbelt equivalent of `bwrapArgs`. The last matching rule wins, so
 * broad denies come first and the narrower allows and masks after them.
 */
function seatbeltProfile(layout: SandboxLayout, opts: { network?: boolean } = {}): string {
	const subpaths = (dirs: string[]) => dirs.map((dir) => `(subpath ${sbpl(dir)})`).join(' ');
	const git = join(layout.checkout, '.git');

	const rules = [
		'(version 1)',
		'(allow default)',
		opts.network ? '' : '(deny network*)',
		layout.hidden.length ? `(deny file-read* file-write* ${subpaths(layout.hidden)})` : '',
		`(allow file-read* ${subpaths([...layout.toolchains, ...(layout.readOnly ?? []), layout.checkout, layout.cacheDir])})`,
		`(allow file-read-metadata ${ancestors([
			...layout.toolchains,
			...(layout.readOnly ?? []),
			layout.checkout,
			layout.cacheDir
		])
			.map((dir) => `(literal ${sbpl(dir)})`)
			.join(' ')})`,
		'(deny file-write*)',
		`(allow file-write* ${subpaths([layout.checkout, layout.cacheDir])} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))`,
		existsSync(git) ? `(deny file-write* (subpath ${sbpl(git)}))` : '',
		...layout.masked.map((file) => `(deny file-read* (literal ${sbpl(file)}))`)
	];

	return rules.filter(Boolean).join('\n');
}

let shellPath: string | null = null;

/** bash when the host has it, else sh. */
function shell(): string {
	shellPath ??= ['/bin/bash', '/usr/bin/bash'].find((path) => existsSync(path)) ?? '/bin/sh';

	return shellPath;
}

let probe: Promise<string | null> | null = null;

/** Null when commands can run here; otherwise why the review stays read-only. */
export function execUnavailableReason(): Promise<string | null> {
	if (process.env.RECODER_EXEC === 'off') return Promise.resolve('Code execution is turned off (RECODER_EXEC=off).');

	probe ??= (async () => {
		if (process.platform === 'darwin') return probeSeatbelt();
		if (process.platform === 'win32')
			return 'Running code is not supported on native Windows. Run the Recoder server under WSL to let reviewers run tests.';
		if (process.platform !== 'linux') return `Running code is not supported on ${process.platform}.`;

		const bwrap = Bun.which('bwrap');

		if (!bwrap) return 'Running code needs bubblewrap (`bwrap`). Install it to let reviewers run tests.';

		return probeSandbox('bubblewrap', [
			bwrap,
			'--die-with-parent',
			'--unshare-all',
			'--ro-bind',
			'/',
			'/',
			'--dev',
			'/dev',
			'--proc',
			'/proc',
			'true'
		]);
	})();

	return probe;
}

async function probeSeatbelt(): Promise<string | null> {
	const bin = Bun.which('sandbox-exec') ?? (existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : null);

	if (!bin) return 'Running code needs `sandbox-exec`, which this macOS install is missing.';

	return probeSandbox('sandbox-exec', [bin, '-p', '(version 1)(allow default)(deny network*)', '/usr/bin/true']);
}

/** Start a trivial sandboxed command: null when it runs, otherwise why `name` could not start a sandbox. */
async function probeSandbox(name: string, argv: string[]): Promise<string | null> {
	try {
		const proc = Bun.spawn(argv, { stdout: 'ignore', stderr: 'pipe' });
		const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

		return code === 0 ? null : `${name} could not start a sandbox: ${stderr.trim().slice(0, 300) || `exit ${code}`}`;
	} catch (err) {
		return `${name} could not start a sandbox: ${err instanceof Error ? err.message : String(err)}`;
	}
}

/** Keeps the head and tail of long output, where commands report what matters. */
function boundOutput(text: string, max: number): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false };

	const head = Math.floor(max * 0.3);
	const tail = max - head;

	return {
		text: `${text.slice(0, head)}\n…[${text.length - max} characters omitted]…\n${text.slice(-tail)}`,
		truncated: true
	};
}

/**
 * How long output may keep arriving after the command exits. A child that left
 * the command's process group (setsid, a daemon, a test that starts a server)
 * can hold the pipes open forever after the command itself is gone.
 */
const PIPE_DRAIN_MS = 1_500;
/** Raw output kept from each pipe: the head and a rolling tail, so a flood can't exhaust memory. */
const PIPE_KEEP_CHARS = 64_000;

/**
 * Output a command's result keeps. An agent's run is cut to fit its turn; the
 * install and baseline checks keep everything the pipes held, because the
 * detectors parse every diagnostic out of them and a lint run over a whole
 * repo is long.
 */
const OUTPUT_CHARS: Record<SandboxTier, number> = { prep: 2 * PIPE_KEEP_CHARS, run: 20_000, light: 20_000 };

/**
 * Read a pipe in the background. `stop()` cancels a read that is still waiting
 * (someone outside the command holds the pipe) and returns what arrived.
 */
function collect(stream: ReadableStream<Uint8Array>): { done: Promise<void>; stop: () => Promise<string> } {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let head = '';
	let tail = '';
	let omitted = 0;
	let finished = false;

	const add = (chunk: string) => {
		if (head.length < PIPE_KEEP_CHARS) {
			const room = PIPE_KEEP_CHARS - head.length;

			head += chunk.slice(0, room);
			chunk = chunk.slice(room);
		}

		tail += chunk;

		if (tail.length > PIPE_KEEP_CHARS) {
			omitted += tail.length - PIPE_KEEP_CHARS;
			tail = tail.slice(-PIPE_KEEP_CHARS);
		}
	};

	const done = (async () => {
		try {
			for (;;) {
				const { done: end, value } = await reader.read();

				if (end) break;
				add(decoder.decode(value, { stream: true }));
			}

			add(decoder.decode());
		} catch {
		} finally {
			finished = true;
		}
	})();

	return {
		done,
		stop: async () => {
			if (!finished) await Promise.race([reader.cancel().catch(() => {}), Bun.sleep(500)]);

			return omitted ? `${head}\n…[${omitted} characters omitted]…\n${tail}` : head + tail;
		}
	};
}

/** The argv that runs `command` inside bubblewrap (at low priority), or Seatbelt on macOS. */
function sandboxArgv(layout: SandboxLayout, command: string, network: boolean | undefined, darwin: boolean): string[] {
	if (!darwin) {
		return [
			...hostPriorityPrefix(),
			...overlayArgv(['bwrap', ...bwrapArgs(layout, command, { network })], layout.overlays)
		];
	}

	return [
		'sandbox-exec',
		'-p',
		seatbeltProfile(layout, { network }),
		shell(),
		'-c',
		'eval "$1" 2>&1',
		'recoder',
		command
	];
}

/** SIGKILL a process group, if it is still there. */
function killGroup(pid: number): void {
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {}
}

/**
 * SIGKILL a sandboxed command. Under bubblewrap that takes the whole sandbox
 * with it (--die-with-parent, PID namespace); on macOS the command leads its
 * own process group, so the whole group goes.
 */
function killSandbox(proc: Bun.Subprocess, darwin: boolean): void {
	if (!darwin) {
		proc.kill('SIGKILL');

		return;
	}

	try {
		process.kill(-proc.pid, 'SIGKILL');
	} catch {
		proc.kill('SIGKILL');
	}
}

/** stdout with stderr after it, on its own line. */
function combineOutput(stdout: string, stderr: string): string {
	if (!stderr.trim()) return stdout;

	return `${stdout}${stdout.endsWith('\n') || !stdout ? '' : '\n'}${stderr}`;
}

/** A result for a command that never started. */
function notStarted(output: string, timedOut: boolean): RunResult {
	return { exitCode: null, output, truncated: false, timedOut, elapsedMs: 0 };
}

/**
 * Run a reviewer command against a PR checkout inside the sandbox: bubblewrap
 * on Linux, Seatbelt (`sandbox-exec`) on macOS. Every command gets its own
 * session and process group, no network (setup's dependency install is the one
 * exception) and a cleared environment. Seatbelt has no PID namespace, so there
 * the command leads its own process group and a kill reaches its children.
 * After it exits, stray children get a moment to drain the pipes before the
 * reads stop and whatever it left behind is killed. It first waits for a host
 * slot (see `host-load.ts`); the timeout and `elapsedMs` cover only the run.
 */
export async function runSandboxed(layout: SandboxLayout, command: string, opts: RunOptions): Promise<RunResult> {
	const tier = resolveTier(opts.tier);
	const release = await admitCommand(tier, opts.signal);

	if (!release) return notStarted('Not run: stopped while waiting for a free sandbox slot.', false);

	try {
		const timeoutMs = typeof opts.timeoutMs === 'function' ? opts.timeoutMs() : opts.timeoutMs;

		if (timeoutMs <= 0) return notStarted('Not run: the review is out of time.', true);

		return await execute(layout, command, opts, timeoutMs, OUTPUT_CHARS[tier]);
	} finally {
		release();
	}
}

/** Spawns one sandboxed command and waits for it; the caller holds a slot. */
async function execute(
	layout: SandboxLayout,
	command: string,
	opts: RunOptions,
	timeoutMs: number,
	outputChars: number
): Promise<RunResult> {
	mkdirSync(layout.cacheDir, { recursive: true });
	prepareOverlays(layout.overlays);
	if (!statSync(layout.checkout).isDirectory()) throw new Error('review checkout is missing');

	const darwin = process.platform === 'darwin';

	if (darwin) {
		mkdirSync(layout.env.HOME!, { recursive: true });
		mkdirSync(layout.env.TMPDIR!, { recursive: true });
	}

	const started = Date.now();

	const proc = Bun.spawn(sandboxArgv(layout, command, opts.network, darwin), {
		stdin: opts.stdin === undefined ? 'ignore' : new Blob([opts.stdin]),
		stdout: 'pipe',
		stderr: 'pipe',
		...(darwin ? { cwd: layout.checkout, env: layout.env, detached: true } : {})
	});

	let timedOut = false;
	const kill = () => killSandbox(proc, darwin);

	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, timeoutMs);

	opts.signal?.addEventListener('abort', kill, { once: true });

	const out = collect(proc.stdout);
	const err = collect(proc.stderr);

	try {
		const code = await proc.exited;

		await Promise.race([Promise.all([out.done, err.done]), Bun.sleep(PIPE_DRAIN_MS)]);
		if (darwin) killGroup(proc.pid);

		const [stdout, stderr] = await Promise.all([out.stop(), err.stop()]);
		const bounded = boundOutput(combineOutput(stdout, stderr), outputChars);

		return {
			exitCode: timedOut || opts.signal?.aborted ? null : code,
			output: bounded.text,
			truncated: bounded.truncated,
			timedOut,
			elapsedMs: Date.now() - started
		};
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', kill);
	}
}
