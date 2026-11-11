import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorCode } from '../exit.js';
import { SKILL_FOLDER_NAME, type SkillFile } from './bundled-skill.js';

/** What stands where a skill would be installed: nothing, this version of the skill, or anything else. */
export type SkillState = 'absent' | 'current' | 'different';

/**
 * Compares `<skillsFolder>/recoder` with the skill's files. `different` covers an older version, a skill someone
 * edited, and an entry that is no folder at all; installing over it is the caller's decision.
 */
export async function readSkillState(skillsFolder: string, source: readonly SkillFile[]): Promise<SkillState> {
	const destination = join(skillsFolder, SKILL_FOLDER_NAME);

	if (!(await exists(destination))) return 'absent';

	const installed = await Promise.all(source.map((file) => readTextOrNull(join(destination, file.path))));

	return installed.every((text, index) => text === source[index].text) ? 'current' : 'different';
}

/** Whether anything is at the path; a symbolic link counts whatever it points at. */
async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);

		return true;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;

		throw error;
	}
}

/** A file's text; null when it is missing or the path runs through something that is not a folder. */
async function readTextOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(errorCode(error) ?? '')) return null;

		throw error;
	}
}
