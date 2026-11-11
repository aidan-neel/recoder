import { createHash, randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { CliError, EXIT, describeError, notReadyError } from '../exit.js';

const EXECUTABLE_MODE = 0o755;

const SHA256_HEX = /^[0-9a-f]{64}$/;

const TEMPORARY_SUFFIX_BYTES = 4;

/** The systems and processors a release has a binary for, as Node names them and as the release's files do. */
const SYSTEMS: Partial<Record<NodeJS.Platform, string>> = { linux: 'linux', darwin: 'darwin' };

const PROCESSORS: Partial<Record<string, string>> = { x64: 'x64', arm64: 'arm64' };

/** The file name of the binary for a machine; a machine no release is built for is not ready for an upgrade. */
export function assetFor(platform: NodeJS.Platform, arch: string): string {
	const system = SYSTEMS[platform];
	const processor = PROCESSORS[arch];

	if (system === undefined || processor === undefined) {
		throw notReadyError(`no release is built for ${platform} on ${arch}.`);
	}

	return `recoder-${system}-${processor}`;
}

/**
 * Checks the downloaded binary against the release's `SHA256SUMS`, which lists a checksum and a file name per line.
 * A missing or malformed entry and a checksum that does not match all refuse the binary: it is never installed.
 */
export function verifyChecksum(binary: Uint8Array, checksums: string, asset: string): void {
	const expected = checksums
		.split('\n')
		.map((line) => line.trim().split(/\s+/))
		.find(([, name]) => name === asset)?.[0];

	if (expected === undefined || !SHA256_HEX.test(expected)) {
		throw new CliError(`the release's SHA256SUMS has no checksum for ${asset}.`, EXIT.failed);
	}

	const actual = createHash('sha256').update(binary).digest('hex');

	if (actual !== expected) {
		throw new CliError(`the download of ${asset} does not match its checksum; nothing was installed.`, EXIT.failed);
	}
}

/**
 * Puts the new binary in the place of the running one. It is written beside the executable and renamed over it, so
 * a reader finds the old program or the new one, never half of one, and the process that is running keeps the old
 * file open. `check` runs the new file before the rename; when it rejects, the old program stays.
 */
export async function replaceExecutable(
	executable: string,
	binary: Uint8Array,
	check: (candidate: string) => Promise<void>
): Promise<void> {
	const candidate = `${executable}.upgrade-${randomBytes(TEMPORARY_SUFFIX_BYTES).toString('hex')}`;

	try {
		await writeFile(candidate, binary, { mode: EXECUTABLE_MODE });
		await check(candidate);
		await rename(candidate, executable);
	} catch (error) {
		await rm(candidate, { force: true });

		if (error instanceof CliError) throw error;

		throw new CliError(
			`cannot replace ${executable}: ${describeError(error)}. Run the installer again if the folder is not yours to write.`,
			EXIT.failed
		);
	}
}
