import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SkillFile } from '../../../src/cli/skill/bundled-skill';

const folders: string[] = [];

/** Removes the folders `temporaryFolder` made. Each test file calls it from `afterEach`; a hook in this module is not run. */
export async function removeTemporaryFolders(): Promise<void> {
	await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
}

/** A new empty folder; the test file's `afterEach` removes it. */
export async function temporaryFolder(): Promise<string> {
	const folder = await realpath(await mkdtemp(join(tmpdir(), 'recoder-skill-')));

	folders.push(folder);

	return folder;
}

/** Writes files given by path relative to `folder`, creating the folders above them. */
export async function writeFiles(folder: string, files: Record<string, string>): Promise<void> {
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(folder, path)), { recursive: true });
		await writeFile(join(folder, path), text);
	}
}

/** A skill to install: a `SKILL.md` and a file in a nested folder. */
export const SAMPLE_SKILL: readonly SkillFile[] = [
	{ path: 'SKILL.md', text: 'skill\n' },
	{ path: 'notes/reference.md', text: 'reference\n' }
];
