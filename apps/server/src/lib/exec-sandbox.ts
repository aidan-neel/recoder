import { existsSync, lstatSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { serverDataDir } from './data-dir.js';

/**
 * Runs reviewer commands against a PR checkout inside bubblewrap. PR code is
 * untrusted, so every command gets:
 * - a read-only host with $HOME, the data dir (tokens), the work dir (other
 *   reviews' checkouts), /run (docker and dbus sockets) and /mnt hidden;
 * - the host toolchains on PATH bound back in read-only;
 * - only the checkout and a per-checkout cache writable, with `.git` read-only
 *   so HEAD cannot move;
 * - no network (setup's dependency install is the one exception), fresh
 *   PID/IPC/UTS namespaces, a cleared environment and a new session.
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

/** Where things live on this host, resolved into what bwrap should hide, bind and set. */
export function sandboxLayout(checkout: string, host: {
	home?: string;
	dataDir?: string;
	workDir?: string;
	path?: string;
} = {}): SandboxLayout {
	const home = resolve(host.home ?? homedir());
	const dataDir = resolve(host.dataDir ?? serverDataDir());
	const workDir = resolve(host.workDir ?? env.RECODER_WORKDIR);
	const root = resolve(checkout);
	const cacheDir = join(workDir, 'cache', basename(root));
	const hidden = [home, dataDir, workDir, '/root', '/mnt', '/media', '/run', '/var/run']
		.filter((path, index, all) => all.indexOf(path) === index && isDir(path))
		.sort((a, b) => a.length - b.length);
	const isHidden = (path: string) => hidden.some((dir) => inside(path, dir));

	const pathEntries = (host.path ?? process.env.PATH ?? '').split(':').filter((entry) => entry.startsWith('/'));
	// Windows drives (WSL) and anything else under a hidden dir that isn't a toolchain drops off PATH.
	const kept = pathEntries.filter((entry) => !inside(entry, '/mnt') && !inside(entry, dataDir) && !inside(entry, workDir));
	const toolchains = new Set<string>();
	for (const entry of kept) {
		if (!isHidden(entry) || !existsSync(entry)) continue;
		const bind = toolchainRoot(entry, home);
		if (bind !== home && !inside(dataDir, bind) && !inside(workDir, bind)) toolchains.add(bind);
	}
	const rustup = join(home, '.rustup');
	if (isDir(rustup)) toolchains.add(rustup);
	const masked = [...toolchains].flatMap((dir) => CREDENTIAL_FILES.map((file) => join(dir, file))).filter((file) => existsSync(file));

	const cache = (name: string) => join(cacheDir, name);
	return {
		checkout: root,
		cacheDir,
		hidden,
		toolchains: [...toolchains].sort((a, b) => a.length - b.length),
		masked,
		env: {
			PATH: kept.join(':') || '/usr/local/bin:/usr/bin:/bin',
			HOME: '/tmp/home',
			TMPDIR: '/tmp',
			LANG: 'C.UTF-8',
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
		if (process.platform !== 'linux') return 'Running code needs bubblewrap, which is Linux only.';
		const bwrap = Bun.which('bwrap');
		if (!bwrap) return 'Running code needs bubblewrap (`bwrap`). Install it to let reviewers run tests.';
		try {
			const proc = Bun.spawn([bwrap, '--die-with-parent', '--unshare-all', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'], { stdout: 'ignore', stderr: 'pipe' });
			const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
			return code === 0 ? null : `bubblewrap could not start a sandbox: ${stderr.trim().slice(0, 300) || `exit ${code}`}`;
		} catch (err) {
			return `bubblewrap could not start a sandbox: ${err instanceof Error ? err.message : String(err)}`;
		}
	})();
	return probe;
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

export async function runSandboxed(layout: SandboxLayout, command: string, opts: RunOptions): Promise<RunResult> {
	mkdirSync(layout.cacheDir, { recursive: true });
	if (!statSync(layout.checkout).isDirectory()) throw new Error('review checkout is missing');
	const started = Date.now();
	const proc = Bun.spawn(['bwrap', ...bwrapArgs(layout, command, { network: opts.network })], {
		stdin: opts.stdin === undefined ? 'ignore' : new Blob([opts.stdin]),
		stdout: 'pipe',
		stderr: 'pipe'
	});
	let timedOut = false;
	// SIGKILL on bwrap takes the whole sandbox with it (--die-with-parent, PID namespace).
	const kill = () => proc.kill('SIGKILL');
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, opts.timeoutMs);
	opts.signal?.addEventListener('abort', kill, { once: true });
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);
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
