import { afterEach, beforeEach, expect, spyOn, test, type Mock } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { runSkillCommand } from '../../../src/cli/skill/skill-command';
import { removeTemporaryFolders, temporaryFolder, writeFiles } from './fixture';

const written: string[] = [];

let stdout: Mock<typeof process.stdout.write>;

beforeEach(() => {
	written.length = 0;

	stdout = spyOn(process.stdout, 'write').mockImplementation((text, callback) => {
		written.push(String(text));

		if (typeof callback === 'function') callback(null);

		return true;
	});
});

afterEach(async () => {
	stdout.mockRestore();
	await removeTemporaryFolders();
});

test('install writes the bundled skill into --dir and prints one JSON line naming it', async () => {
	const working = await temporaryFolder();

	const code = await runSkillCommand(['install', '--dir', 'skills'], working);

	expect(code).toBe(EXIT.ok);
	expect(written).toHaveLength(1);
	expect(JSON.parse(written[0])).toMatchObject({ installed: join(working, 'skills', 'recoder') });
	expect(existsSync(join(working, 'skills', 'recoder', 'SKILL.md'))).toBe(true);
});

test('install into an existing recoder folder is a usage error that names it', async () => {
	const working = await temporaryFolder();

	await writeFiles(working, { 'skills/recoder/SKILL.md': 'mine\n' });

	const run = runSkillCommand(['install', '--dir', 'skills'], working);

	await expect(run).rejects.toMatchObject({
		exitCode: EXIT.usage,
		message: expect.stringContaining(join(working, 'skills', 'recoder'))
	});

	expect(written).toHaveLength(0);
});

test('path prints the folder that holds the bundled SKILL.md', async () => {
	await runSkillCommand(['path'], await temporaryFolder());

	expect(existsSync(join(written[0].trim(), 'SKILL.md'))).toBe(true);
});

test.each([
	[['unknown']],
	[['show', 'extra']],
	[['path', '--dir', 'x']],
	[['install', 'extra']],
	[['install', '--agent', 'codex']],
	[['install', '--scope', 'team']],
	[['install', '--dir', 'x', '--agent', 'claude']],
	[['install', '--dir', 'x', '--scope', 'project']]
])('%j is a usage error', async (argv) => {
	await expect(runSkillCommand(argv, await temporaryFolder())).rejects.toMatchObject({ exitCode: EXIT.usage });
});
