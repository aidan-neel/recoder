import { CliError, EXIT } from '../exit.js';
import { assetFor, replaceExecutable, verifyChecksum } from './install-binary.js';
import type { ReleaseSource } from './release-source.js';
import { isNewerRelease, versionOfTag, type ReleaseTag } from './release-tag.js';

/** What `recoder upgrade` was asked to do. */
export interface UpgradeRequest {
	/** The release to install, newer or older; null is the latest one. */
	to: ReleaseTag | null;
	/** Only say whether there is something to install. */
	checkOnly: boolean;
}

/** The program that is running and the machine it runs on; injected so a test owns both. */
export interface RunningProgram {
	version: string;
	/** The binary to replace; null when the program runs from source, which has none. */
	executable: string | null;
	platform: NodeJS.Platform;
	arch: string;
	releases: ReleaseSource;
	/** Runs a new binary before it is installed and rejects when it is not the version asked for. */
	check: (candidate: string, version: string) => Promise<void>;
	signal: AbortSignal;
}

/** The release an upgrade would install, and whether there is any need to. */
export interface UpgradePlan {
	tag: ReleaseTag;
	/** False when the program already is that release, or is newer than the latest. */
	isNeeded: boolean;
}

/**
 * How an upgrade ended, as a program reads it. `current`: nothing to install. `available`: `--check` found a release
 * to install. `upgraded`: the binary at `path` is now `targetVersion`. JSON-safe.
 */
export interface UpgradeResult {
	state: 'current' | 'available' | 'upgraded';
	currentVersion: string;
	targetVersion: string;
	path: string | null;
}

/**
 * Finds the release to install. With no release named it is the latest, and needed only when it is newer than the
 * program; a named release is needed whenever it is another version, so `--to` can also go back.
 */
export async function planUpgrade(request: UpgradeRequest, program: RunningProgram): Promise<UpgradePlan> {
	if (request.to !== null) return { tag: request.to, isNeeded: versionOfTag(request.to) !== program.version };

	const tag = await program.releases.latestTag(program.signal);

	return { tag, isNeeded: isNewerRelease(tag, program.version) };
}

/**
 * Downloads the release's binary for this machine, checks it against the release's checksums, runs it once, and
 * puts it in place of the running program. A program run from source has no binary to replace and is refused.
 */
export async function installRelease(tag: ReleaseTag, program: RunningProgram): Promise<string> {
	if (program.executable === null) {
		throw new CliError(
			'this recoder runs from source, so there is no binary to replace. Update the checkout instead.',
			EXIT.failed
		);
	}

	const asset = assetFor(program.platform, program.arch);

	const [checksums, binary] = await Promise.all([
		program.releases.checksums(tag, program.signal),
		program.releases.binary(tag, asset, program.signal)
	]);

	verifyChecksum(binary, checksums, asset);
	await replaceExecutable(program.executable, binary, (candidate) => program.check(candidate, versionOfTag(tag)));

	return program.executable;
}

/** How a plan ended: `installedAt` is where the new binary went, or null when nothing was installed. */
export function resultOfPlan(plan: UpgradePlan, program: RunningProgram, installedAt: string | null): UpgradeResult {
	return {
		state: stateOf(plan, installedAt),
		currentVersion: program.version,
		targetVersion: versionOfTag(plan.tag),
		path: installedAt
	};
}

function stateOf(plan: UpgradePlan, installedAt: string | null): UpgradeResult['state'] {
	if (installedAt !== null) return 'upgraded';

	return plan.isNeeded ? 'available' : 'current';
}
