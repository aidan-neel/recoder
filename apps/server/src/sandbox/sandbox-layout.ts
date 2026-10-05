import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { env } from '../env.js';
import { serverDataDir } from '../util/data-dir.js';
import type { OverlayMount } from './overlay.js';

export interface SandboxLayout {
	checkout: string;
	cacheDir: string;
	/** Where installs and package stores shared by reviews of one repo live; the sandbox never sees it. */
	sharedDir: string;
	/** Where overlay layers live; hidden from the sandbox like the rest of the work dir. */
	layersDir: string;
	/** Shared directories shown read-only at a path in the checkout or cache, with writes kept in a private layer. Set by setup. */
	overlays: OverlayMount[];
	/** Host directories replaced by an empty tmpfs, parents before children. */
	hidden: string[];
	/** Toolchain directories bound back read-only on top of `hidden`. */
	toolchains: string[];
	/** Host directories bound back read-only, such as the head checkout a merge-base tree links its dependencies from. */
	readOnly?: string[];
	/** Files masked with /dev/null inside bound toolchains (registry credentials). */
	masked: string[];
	env: Record<string, string>;
}

/** Host locations to resolve the layout against; each defaults to the real host's. */
interface HostPaths {
	home?: string;
	dataDir?: string;
	workDir?: string;
	path?: string;
	platform?: NodeJS.Platform;
}

const CREDENTIAL_FILES = ['credentials', 'credentials.toml', '.credentials.json', 'auth.json', '.npmrc', '.netrc'];

function isDir(path: string): boolean {
	try {
		return lstatSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function inside(path: string, dir: string): boolean {
	return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

/** A PATH entry's toolchain root: `~/.bun/bin` → `~/.bun`, `~/.nvm/versions/node/v24/bin` → `…/v24`. */
function toolchainRoot(entry: string, home: string): string {
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

/**
 * The PATH entries a sandboxed command keeps. Windows drives (WSL), the data
 * dir and the work dir drop off; anything else under a hidden dir stays only
 * because its toolchain is bound back in.
 */
function keptPath(path: string, dataDir: string, workDir: string): string[] {
	return path
		.split(':')
		.filter((entry) => entry.startsWith('/'))
		.filter((entry) => !inside(entry, '/mnt') && !inside(entry, dataDir) && !inside(entry, workDir));
}

/**
 * The environment a sandboxed command starts with: every tool's cache points
 * into the per-checkout cache. On macOS pnpm keeps its own version instead of
 * switching to the one a repo pins, because pnpm 12 can't open its store lock
 * under Seatbelt and every install and check would fail. pnpm's home sits in
 * the shared store so the pinned version it fetched is reused, and its install
 * check before `pnpm run` is off: a shared install records another checkout's
 * paths, so pnpm would call it stale and reinstall offline.
 */
function sandboxEnv(path: string[], cacheDir: string, darwin: boolean, rustup: string | null): Record<string, string> {
	const cache = (name: string) => join(cacheDir, name);

	return {
		PATH: path.join(':') || '/usr/local/bin:/usr/bin:/bin',
		HOME: darwin ? cache('home') : '/tmp/home',
		TMPDIR: darwin ? cache('tmp') : '/tmp',
		LANG: darwin ? 'en_US.UTF-8' : 'C.UTF-8',
		TERM: 'dumb',
		CI: '1',
		NO_COLOR: '1',
		FORCE_COLOR: '0',
		PYTHONDONTWRITEBYTECODE: '1',
		XDG_CACHE_HOME: cache('xdg'),
		BUN_INSTALL_CACHE_DIR: cache('store/bun'),
		npm_config_cache: cache('store/npm'),
		YARN_CACHE_FOLDER: cache('store/yarn'),
		PNPM_HOME: cache('store/pnpm-home'),
		npm_config_store_dir: cache('store/pnpm'),
		pnpm_config_verify_deps_before_run: 'false',
		...(darwin ? { npm_config_manage_package_manager_versions: 'false' } : {}),
		PIP_CACHE_DIR: cache('pip'),
		UV_CACHE_DIR: cache('uv'),
		GOMODCACHE: cache('gomod'),
		GOCACHE: cache('gobuild'),
		GOPATH: cache('gopath'),
		CARGO_HOME: cache('cargo'),
		...(rustup ? { RUSTUP_HOME: rustup } : {})
	};
}

/**
 * The shared object directories a checkout borrows from (its alternates) that
 * sit inside the shared clone dir. Only those come back, to be bound read-only;
 * an alternate anywhere else is ignored.
 */
function sharedObjects(checkout: string, workDir: string): string[] {
	const shared = join(workDir, 'shared', 'git');

	try {
		return readFileSync(join(checkout, '.git', 'objects', 'info', 'alternates'), 'utf8')
			.split('\n')
			.filter((line) => line.startsWith('/'))
			.map(real)
			.filter((path) => inside(path, shared) && isDir(path));
	} catch {
		return [];
	}
}

/**
 * Where things live on this host, resolved into what the sandbox should hide,
 * bind and set. PR code is untrusted, so $HOME, the data dir (tokens), the work
 * dir (other reviews' checkouts), /run (docker and dbus sockets) and /mnt are
 * hidden, and only the toolchains on PATH come back, read-only. Seatbelt can't
 * mount a fresh /tmp, so on macOS /tmp is hidden too and HOME and TMPDIR point
 * into the per-checkout cache.
 */
export function sandboxLayout(checkout: string, host: HostPaths = {}): SandboxLayout {
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
	const kept = keptPath(host.path ?? process.env.PATH ?? '', dataDir, workDir);
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

	return {
		checkout: root,
		cacheDir,
		sharedDir: join(workDir, 'shared'),
		layersDir: join(workDir, 'cache', `${basename(root)}.layers`),
		overlays: [],
		hidden,
		toolchains: [...toolchains].sort((a, b) => a.length - b.length),
		readOnly: sharedObjects(root, workDir),
		masked,
		env: sandboxEnv(kept, cacheDir, darwin, isDir(rustup) ? rustup : null)
	};
}
