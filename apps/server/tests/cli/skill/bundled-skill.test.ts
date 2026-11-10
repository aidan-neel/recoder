import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { findSkillFile } from '../../../src/cli/skill/bundled-skill';
import { removeTemporaryFolders, sampleSkill, temporaryFolder } from './fixture';

afterEach(removeTemporaryFolders);

test('a skill folder with its SKILL.md gives that file', async () => {
	const folder = await sampleSkill();

	expect(await findSkillFile(folder)).toBe(join(folder, 'SKILL.md'));
});

test('a skill folder without its SKILL.md fails with the missing path and no stack', async () => {
	const folder = await temporaryFolder();

	await expect(findSkillFile(folder)).rejects.toMatchObject({
		exitCode: EXIT.failed,
		message: expect.stringContaining(join(folder, 'SKILL.md'))
	});
});
