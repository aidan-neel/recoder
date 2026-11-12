import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The only variables a process a test starts gets: what it needs to run, a home, a work folder and a data folder of
 * its own under `dataDir`, and the agent binaries switched off. No model setting, token or real folder can reach it.
 * `Bun.spawn` without `env` would pass the variables this process started with, whatever the test set since.
 */
export function childEnvironment(dataDir: string): Record<string, string> {
	if (!isUnderTempFolder(dataDir)) throw new Error(`${dataDir} is not under the temp folder`);

	const home = join(dataDir, 'home');
	const work = join(dataDir, 'work');

	mkdirSync(home, { recursive: true });
	mkdirSync(work, { recursive: true });

	return {
		PATH: process.env.PATH ?? '',
		HOME: home,
		TMPDIR: tmpdir(),
		RECODER_DATA_DIR: dataDir,
		RECODER_WORKDIR: work,
		RECODER_OPENCODE_BIN: '',
		RECODER_CLAUDE_BIN: '',
		RECODER_ANTIGRAVITY_BIN: ''
	};
}

/** The temp folder as it is named and as it resolves: on macOS `/var` links to `/private/var`, and fixtures resolve. */
function isUnderTempFolder(path: string): boolean {
	return [tmpdir(), realpathSync(tmpdir())].some((folder) => path.startsWith(folder));
}

/** The data folder the test runs with now; `useFreshDataDir` gives each test its own under the temp folder. */
export function testDataDir(): string {
	const dataDir = process.env.RECODER_DATA_DIR;

	if (dataDir === undefined) throw new Error('RECODER_DATA_DIR is not set');

	return dataDir;
}
