import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CliError, EXIT } from '../../../src/cli/exit';
import type { ReleaseSource } from '../../../src/cli/upgrade/release-source';
import { parseReleaseTag } from '../../../src/cli/upgrade/release-tag';
import { installRelease, planUpgrade, type RunningProgram } from '../../../src/cli/upgrade/upgrade';
import { removeTemporaryFolders, temporaryFolder, writeFiles } from '../skill/fixture';

afterEach(removeTemporaryFolders);

const NEW_BINARY = new TextEncoder().encode('the new program');

const NEW_TAG = parseReleaseTag('v0.3.0');

const ASSET = 'recoder-linux-x64';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A release source that serves `NEW_BINARY` as the latest release, with the parts a test sets replaced. */
function releases(overrides: Partial<ReleaseSource> = {}): ReleaseSource {
	return {
		latestTag: async () => NEW_TAG,
		checksums: async () => `${sha256(NEW_BINARY)}  ${ASSET}\n`,
		binary: async () => NEW_BINARY,
		...overrides
	};
}

/** A program of version 0.2.0 on Linux and the file it is installed as, with the parts a test sets replaced. */
async function installedProgram(overrides: Partial<RunningProgram> = {}) {
	const executable = join(await temporaryFolder(), 'recoder');

	await writeFiles(join(executable, '..'), { recoder: 'the old program' });

	const program: RunningProgram = {
		version: '0.2.0',
		executable,
		platform: 'linux',
		arch: 'x64',
		releases: releases(),
		check: async () => {},
		signal: new AbortController().signal,
		...overrides
	};

	return { program, executable };
}

const textOf = (path: string): string => readFileSync(path, 'utf8');

test('the latest release is needed only when it is newer than the program', async () => {
	const isNeededFor = async (version: string): Promise<boolean> => {
		const { program } = await installedProgram({ version });

		return (await planUpgrade({ to: null, checkOnly: false }, program)).isNeeded;
	};

	expect(await isNeededFor('0.2.0')).toBe(true);
	expect(await isNeededFor('0.3.0')).toBe(false);
	expect(await isNeededFor('0.4.0')).toBe(false);
});

test('a release named with --to is needed whenever it is another version, older ones too, and nothing is looked up', async () => {
	const latestTag = async (): Promise<never> => {
		throw new Error('looked up the latest release though one was named');
	};

	const { program } = await installedProgram({ releases: releases({ latestTag }) });
	const back = parseReleaseTag('v0.1.0');

	expect(await planUpgrade({ to: back, checkOnly: false }, program)).toEqual({ tag: back, isNeeded: true });
	expect((await planUpgrade({ to: parseReleaseTag('v0.2.0'), checkOnly: false }, program)).isNeeded).toBe(false);
});

test('a verified download replaces the program with an executable file and leaves nothing beside it', async () => {
	const { program, executable } = await installedProgram();

	expect(await installRelease(NEW_TAG, program)).toBe(executable);
	expect(textOf(executable)).toBe('the new program');
	expect(statSync(executable).mode & 0o111).not.toBe(0);
	expect(readdirSync(join(executable, '..'))).toEqual(['recoder']);
});

test.each([
	['does not match the binary', `${'0'.repeat(64)}  ${ASSET}\n`],
	['has no entry for this machine', `${sha256(NEW_BINARY)}  recoder-darwin-arm64\n`],
	['holds something that is not a checksum', `not-a-checksum  ${ASSET}\n`]
])('a SHA256SUMS that %s refuses the download and the old program stays', async (_, checksums) => {
	const { program, executable } = await installedProgram({ releases: releases({ checksums: async () => checksums }) });

	await expect(installRelease(NEW_TAG, program)).rejects.toMatchObject({ exitCode: EXIT.failed });
	expect(textOf(executable)).toBe('the old program');
});

test('a new binary that does not run as the release is not installed, and is removed', async () => {
	const check = async (): Promise<never> => {
		throw new CliError('the new binary does not run', EXIT.failed);
	};

	const { program, executable } = await installedProgram({ check });

	await expect(installRelease(NEW_TAG, program)).rejects.toThrow('does not run');
	expect(textOf(executable)).toBe('the old program');
	expect(readdirSync(join(executable, '..'))).toEqual(['recoder']);
});

test('the new binary is checked against the version of the release before it is installed', async () => {
	const checked: string[] = [];

	const { program } = await installedProgram({
		check: async (candidate, version) => {
			checked.push(`${textOf(candidate)} as ${version}`);
		}
	});

	await installRelease(NEW_TAG, program);

	expect(checked).toEqual(['the new program as 0.3.0']);
});

test('a program run from source has no binary to replace and downloads nothing', async () => {
	const binary = async (): Promise<never> => {
		throw new Error('downloaded a binary with nothing to replace');
	};

	const { program } = await installedProgram({ executable: null, releases: releases({ binary }) });

	await expect(installRelease(NEW_TAG, program)).rejects.toMatchObject({ exitCode: EXIT.failed });
});

test('a machine no release is built for is not ready, and downloads nothing', async () => {
	const { program, executable } = await installedProgram({ platform: 'win32' });

	await expect(installRelease(NEW_TAG, program)).rejects.toMatchObject({ exitCode: EXIT.notReady });
	expect(textOf(executable)).toBe('the old program');
});
