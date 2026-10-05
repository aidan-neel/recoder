import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A shared directory shown read-only under `target`, with every write kept in `upper`. */
export interface OverlayMount {
	lower: string;
	upper: string;
	work: string;
	target: string;
}

/** Paths that cannot break overlayfs's comma and colon separated option string. */
const MOUNTABLE = /^[^,:\\\n]+$/;

/**
 * Mounts each overlay, then runs the command. The mounts happen in a fresh
 * user and mount namespace of their own, so the sandbox sees only the merged
 * result and never gets a way to mount anything itself.
 */
const MOUNT_SCRIPT =
	'set -e; while [ "$1" != -- ]; do mount -t overlay overlay -o "lowerdir=$1,upperdir=$2,workdir=$3" "$4"; shift 4; done; shift; exec "$@"';

/** Whether every path of the mount can go into the option string. */
export function mountable(mount: OverlayMount): boolean {
	return [mount.lower, mount.upper, mount.work, mount.target].every((path) => MOUNTABLE.test(path));
}

/** `argv` run after the overlays are mounted; the argv itself when there are none. */
export function overlayArgv(argv: string[], mounts: OverlayMount[]): string[] {
	if (!mounts.length) return argv;

	return [
		'unshare',
		'--user',
		'--map-root-user',
		'--mount',
		'sh',
		'-c',
		MOUNT_SCRIPT,
		'recoder',
		...mounts.flatMap((mount) => [mount.lower, mount.upper, mount.work, mount.target]),
		'--',
		...argv
	];
}

/** Creates the private layer and the mount point of each overlay; overlayfs refuses to mount without them. */
export function prepareOverlays(mounts: OverlayMount[]): void {
	for (const mount of mounts) {
		for (const dir of [mount.upper, mount.work, mount.target]) mkdirSync(dir, { recursive: true });
	}
}

/** Removes overlay layers. Overlayfs leaves a `work/work` folder with no permissions, which `rm` cannot enter until it is opened up. */
export async function removeOverlayDirs(dir: string): Promise<void> {
	await Bun.spawn(['chmod', '-R', 'u+rwx', dir], { stdout: 'ignore', stderr: 'ignore' }).exited;
	await rm(dir, { recursive: true, force: true });
}

let probe: Promise<string | null> | null = null;

/**
 * Null when overlay mounts work here; otherwise why shared installs are copied
 * instead. Linux only: macOS has no overlayfs, and some distributions (Ubuntu
 * 24.04 with AppArmor) forbid mounts inside a user namespace.
 */
export function overlayUnavailableReason(): Promise<string | null> {
	if (process.env.RECODER_OVERLAY === 'off')
		return Promise.resolve('Overlay mounts are turned off (RECODER_OVERLAY=off).');
	if (process.platform !== 'linux') return Promise.resolve('Overlay mounts need Linux.');

	probe ??= (async () => {
		const dir = await mkdtemp(join(tmpdir(), 'recoder-overlay-probe-'));

		const mount: OverlayMount = {
			lower: join(dir, 'lower'),
			upper: join(dir, 'upper'),
			work: join(dir, 'work'),
			target: join(dir, 'merged')
		};

		try {
			mkdirSync(mount.lower);
			prepareOverlays([mount]);

			const proc = Bun.spawn(overlayArgv(['true'], [mount]), { stdout: 'ignore', stderr: 'pipe' });
			const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

			return code === 0 ? null : `Overlay mounts failed: ${stderr.trim().slice(0, 300) || `exit ${code}`}`;
		} catch (err) {
			return `Overlay mounts failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			await removeOverlayDirs(dir);
		}
	})();

	return probe;
}

/**
 * Copies a directory tree without following links. APFS and btrfs clone the
 * files instead of copying their bytes when asked to; where that is not
 * supported the plain copy runs. `to` must not exist.
 */
export async function copyTree(from: string, to: string): Promise<void> {
	const flags =
		process.platform === 'darwin'
			? [
					['-c', '-R', '-P', '-p'],
					['-R', '-P', '-p']
				]
			: [['-a', '--reflink=auto'], ['-a']];

	await mkdir(dirname(to), { recursive: true });

	for (const attempt of flags) {
		const proc = Bun.spawn(['cp', ...attempt, from, to], { stdout: 'ignore', stderr: 'pipe' });
		const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

		if (code === 0) return;
		if (attempt === flags.at(-1)) throw new Error(`could not copy ${from}: ${stderr.trim().slice(0, 200)}`);
		await rm(to, { recursive: true, force: true });
	}
}
