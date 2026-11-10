import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CliError, EXIT, describeError, errorCode } from '../exit.js';

/** The folder name the skill is installed under, and the `name` in its `SKILL.md`. */
export const SKILL_FOLDER_NAME = 'recoder';

/** The file an agent loads first. */
const SKILL_FILE_NAME = 'SKILL.md';

/** The skill that ships with the program, found from this file so it works wherever the repository is checked out. */
export const BUNDLED_SKILL_FOLDER = resolve(import.meta.dir, '../../../skills', SKILL_FOLDER_NAME);

/**
 * The path of the `SKILL.md` in `folder`, once it is known to be there. A checkout without its `skills` folder would
 * otherwise print a path that leads nowhere, or fail with a bare system error.
 */
export async function findSkillFile(folder: string): Promise<string> {
	const file = join(folder, SKILL_FILE_NAME);

	const found = await stat(file).catch((error: unknown) => {
		const reason = errorCode(error) === 'ENOENT' ? 'it does not exist' : describeError(error);

		throw new CliError(`the bundled skill is missing: cannot read ${file}: ${reason}.`, EXIT.failed);
	});

	if (!found.isFile()) throw new CliError(`the bundled skill is missing: ${file} is not a file.`, EXIT.failed);

	return file;
}
