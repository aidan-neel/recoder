import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { serverDataDir } from '../util/data-dir.js';

/**
 * Runs reviewer commands against a PR checkout inside bubblewrap on Linux and
 * Seatbelt (`sandbox-exec`) on macOS. Native Windows stays read-only. PR code is
 * untrusted, so every command gets:
 * - a read-only host with $HOME, the data dir (tokens), the work dir (other
 *   reviews' checkouts), /run (docker and dbus sockets) and /mnt hidden;
 * - the host toolchains on PATH bound back in read-only;
 * - only the checkout and a per-checkout cache writable, with `.git` read-only
 *   so HEAD cannot move;
 * - no network (setup's dependency install is the one exception), a cleared
 *   environment and its own session / process group (plus fresh PID/IPC/UTS
 *   namespaces under bubblewrap).
 * Seatbelt can't mount a fresh /tmp, so on macOS /tmp is hidden too and HOME and
 * TMPDIR point into the per-checkout cache.
 */

export interface SandboxLayout {
	checkout: string;
	cacheDir: string;
	/** Host directories replaced by an empty tmpfs, parents before children. */
	hidden: string[];
	/** Toolchain directories bound back read-only on top of `hidden`. */
	toolchains: string[];
	/** Files masked with /dev/null inside bound toolchains (registry credentials). */
	masked: string[];
	env: Record<string, string>;
}

export interface RunOptions {
	network?: boolean;
	timeoutMs: number;
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

const CREDENTIAL_FILES = ['credentials', 'credentials.toml', '.credentials.json', 'auth.json', '.npmrc', '.netrc'];

function isDir(path: string): boolean {
	try {
		return lstatSync(path).isDirectory();
	} catch {
		return false;
	}
}

function inside(path: string, dir: string): boolean {
	return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

/** A PATH entry's toolchain root: `~/.bun/bin` → `~/.bun`, `~/.nvm/versions/node/v24/bin` → `…/v24`. */
export function toolchainRoot(entry: string, home: string): string {
	const parent = dirname(entry);

	if (basename(entry) !== 'bin' || parent === home || parent === join(home, '.local') || parent === '/') return entry;

	return parent;
}

/** Seatbelt matches resolved paths (`/tmp` is `/private/tmp` on macOS). */
function real(path: string): string {
	const absolute = resolve(path);

	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

/** Where things live on this host, resolved into what the sandbox should hide, bind and set. */
export function sandboxLayout(
	checkout: string,
	host: {
		home?: string;
		dataDir?: string;
		workDir?: string;
		path?: string;
		platform?: NodeJS.Platform;
	} = {}
): SandboxLayout {
	const darwin = (host.platform ?? process.platform) === 'darwin';
	const home = real(host.home ?? homedir());
	const dataDir = real(host.dataDir ?? serverDataDir());
	const workDir = real(host.workDir ?? env.RECODER_WORKDIR);
	const root = real(checkout);
	const cacheDir = join(workDir, 'cache', basename(root));

	const hostDirs = darwin
		? ['/private/tmp', '/Volumes', '/private/var/root']
		: ['/root', '/mnt', '/media', '/run', '/var/run'];

	const hidden = [home, dataDir, workDir, ...hostDirs]
		.filter((path, index, all) => all.indexOf(path) === index && isDir(path))
		.sort((a, b) => a.length - b.length);

	const isHidden = (path: string) => hidden.some((dir) => inside(path, dir));

	const pathEntries = (host.path ?? process.env.PATH ?? '').split(':').filter((entry) => entry.startsWith('/'));

	// Windows drives (WSL) and anything else under a hidden dir that isn't a toolchain drops off PATH.
	const kept = pathEntries.filter(
		(entry) => !inside(entry, '/mnt') && !inside(entry, dataDir) && !inside(entry, workDir)
	);

	const toolchains = new Set<string>();

	for (const entry of kept) {
		if (!isHidden(entry) || !existsSync(entry)) continue;

		const bind = toolchainRoot(entry, home);

		if (bind !== home && !inside(dataDir, bind) && !inside(workDir, bind)) toolchains.add(bind);
	}

	const rustup = join(home, '.rustup');

	if (isDir(rustup)) toolchains.add(rustup);

	const masked = [...toolchains]
		.flatMap((dir) => CREDENTIAL_FILES.map((file) => join(dir, file)))
		.filter((file) => existsSync(file));

	const cache = (name: string) => join(cacheDir, name);

	return {
		checkout: root,
		cacheDir,
		hidden,
		toolchains: [...toolchains].sort((a, b) => a.length - b.length),
		masked,
		env: {
			PATH: kept.join(':') || '/usr/local/bin:/usr/bin:/bin',
			HOME: darwin ? cache('home') : '/tmp/home',
			TMPDIR: darwin ? cache('tmp') : '/tmp',
			LANG: darwin ? 'en_US.UTF-8' : 'C.UTF-8',
			TERM: 'dumb',
			CI: '1',
			NO_COLOR: '1',
			FORCE_COLOR: '0',
			PYTHONDONTWRITEBYTECODE: '1',
			XDG_CACHE_HOME: cache('xdg'),
			BUN_INSTALL_CACHE_DIR: cache('bun'),
			npm_config_cache: cache('npm'),
			YARN_CACHE_FOLDER: cache('yarn'),
			PNPM_HOME: cache('pnpm-home'),
			npm_config_store_dir: cache('pnpm'),
			PIP_CACHE_DIR: cache('pip'),
			UV_CACHE_DIR: cache('uv'),
			GOMODCACHE: cache('gomod'),
			GOCACHE: cache('gobuild'),
			GOPATH: cache('gopath'),
			CARGO_HOME: cache('cargo'),
			...(isDir(rustup) ? { RUSTUP_HOME: rustup } : {})
		}
	};
}

export function bwrapArgs(layout: SandboxLayout, command: string, opts: { network?: boolean } = {}): string[] {
	const args = ['--die-with-parent', '--new-session', '--unshare-all'];

	if (opts.network) args.push('--share-net');
	args.push('--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--dir', '/tmp/home');

	for (const dir of layout.hidden) {
		// /tmp is already a fresh tmpfs; its children need no second one.
		if (!inside(dir, '/tmp')) args.push('--tmpfs', dir);
	}

	// DNS for the networked install; systemd-resolved keeps its stub under /run.
	if (opts.network) args.push('--ro-bind-try', '/run/systemd/resolve', '/run/systemd/resolve');
	for (const dir of layout.toolchains) args.push('--ro-bind', dir, dir);
	for (const file of layout.masked) args.push('--ro-bind', '/dev/null', file);
	args.push('--bind', layout.checkout, layout.checkout);

	const git = join(layout.checkout, '.git');

	if (existsSync(git)) args.push('--ro-bind', git, git);
	args.push('--bind', layout.cacheDir, layout.cacheDir, '--chdir', layout.checkout, '--clearenv');
	for (const [key, value] of Object.entries(layout.env)) args.push('--setenv', key, value);
	// stderr joins stdout so the agent sees output in the order it was written.
	args.push('--', shell(), '-c', 'eval "$1" 2>&1', 'recoder', command);

	return args;
}

/** SBPL string literal. */
function sbpl(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Every parent directory of these paths, `/` included. */
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
export function seatbeltProfile(layout: SandboxLayout, opts: { network?: boolean } = {}): string {
	const subpaths = (dirs: string[]) => dirs.map((dir) => `(subpath ${sbpl(dir)})`).join(' ');
	const git = join(layout.checkout, '.git');

	const rules = [
		'(version 1)',
		'(allow default)',
		opts.network ? '' : '(deny network*)',
		layout.hidden.length ? `(deny file-read* file-write* ${subpaths(layout.hidden)})` : '',
		`(allow file-read* ${subpaths([...layout.toolchains, layout.checkout, layout.cacheDir])})`,
		// Path walks (mkdir -p, realpath) stat every parent of what's allowed; that reveals
		// nothing, while listing or reading those parents stays denied.
		`(allow file-read-metadata ${ancestors([...layout.toolchains, layout.checkout, layout.cacheDir])
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

		try {
			const proc = Bun.spawn(
				[
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
				],
				{ stdout: 'ignore', stderr: 'pipe' }
			);

			const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

			return code === 0
				? null
				: `bubblewrap could not start a sandbox: ${stderr.trim().slice(0, 300) || `exit ${code}`}`;
		} catch (err) {
			return `bubblewrap could not start a sandbox: ${err instanceof Error ? err.message : String(err)}`;
		}
	})();

	return probe;
}

async function probeSeatbelt(): Promise<string | null> {
	const bin = Bun.which('sandbox-exec') ?? (existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : null);

	if (!bin) return 'Running code needs `sandbox-exec`, which this macOS install is missing.';

	try {
		const proc = Bun.spawn([bin, '-p', '(version 1)(allow default)(deny network*)', '/usr/bin/true'], {
			stdout: 'ignore',
			stderr: 'pipe'
		});

		const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

		return code === 0
			? null
			: `sandbox-exec could not start a sandbox: ${stderr.trim().slice(0, 300) || `exit ${code}`}`;
	} catch (err) {
		return `sandbox-exec could not start a sandbox: ${err instanceof Error ? err.message : String(err)}`;
	}
}

/** Keeps the head and tail of long output, where commands report what matters. */
export function boundOutput(text: string, max: number): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false };

	const head = Math.floor(max * 0.3);
	const tail = max - head;

	return {
		text: `${text.slice(0, head)}\n…[${text.length - max} characters omitted]…\n${text.slice(-tail)}`,
		truncated: true
	};
}

/** How long output may keep arriving after the command exits. */
const PIPE_DRAIN_MS = 1_500;
/** Raw output kept from each pipe: the head and a rolling tail, so a flood can't exhaust memory. */
const PIPE_KEEP_CHARS = 64_000;

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
			/* cancelled or the pipe broke: keep what arrived */
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

export async function runSandboxed(layout: SandboxLayout, command: string, opts: RunOptions): Promise<RunResult> {
	mkdirSync(layout.cacheDir, { recursive: true });
	if (!statSync(layout.checkout).isDirectory()) throw new Error('review checkout is missing');

	const darwin = process.platform === 'darwin';

	if (darwin) {
		mkdirSync(layout.env.HOME!, { recursive: true });
		mkdirSync(layout.env.TMPDIR!, { recursive: true });
	}

	const started = Date.now();

	const argv = darwin
		? [
				'sandbox-exec',
				'-p',
				seatbeltProfile(layout, { network: opts.network }),
				shell(),
				'-c',
				'eval "$1" 2>&1',
				'recoder',
				command
			]
		: ['bwrap', ...bwrapArgs(layout, command, { network: opts.network })];

	const proc = Bun.spawn(argv, {
		stdin: opts.stdin === undefined ? 'ignore' : new Blob([opts.stdin]),
		stdout: 'pipe',
		stderr: 'pipe',
		// Seatbelt has no PID namespace: the command leads its own process group so a kill reaches its children.
		...(darwin ? { cwd: layout.checkout, env: layout.env, detached: true } : {})
	});

	let timedOut = false;

	// SIGKILL on bwrap takes the whole sandbox with it (--die-with-parent, PID namespace);
	// on macOS the whole process group goes.
	const kill = () => {
		if (!darwin) return proc.kill('SIGKILL');

		try {
			process.kill(-proc.pid, 'SIGKILL');
		} catch {
			proc.kill('SIGKILL');
		}
	};

	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, opts.timeoutMs);

	opts.signal?.addEventListener('abort', kill, { once: true });

	const out = collect(proc.stdout);
	const err = collect(proc.stderr);

	try {
		const code = await proc.exited;

		// A child that left the command's process group (setsid, a daemon, a test that starts a
		// server) can hold the pipes open forever after the command itself is gone. Give them a
		// moment to drain, then stop reading and clean up whatever the command left behind.
		await Promise.race([Promise.all([out.done, err.done]), Bun.sleep(PIPE_DRAIN_MS)]);

		if (darwin) {
			try {
				process.kill(-proc.pid, 'SIGKILL');
			} catch {
				/* the group is already gone */
			}
		}

		const [stdout, stderr] = await Promise.all([out.stop(), err.stop()]);
		const combined = stderr.trim() ? `${stdout}${stdout.endsWith('\n') || !stdout ? '' : '\n'}${stderr}` : stdout;
		const bounded = boundOutput(combined, 20_000);

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
