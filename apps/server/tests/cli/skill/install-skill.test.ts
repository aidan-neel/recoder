import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { installSkill } from '../../../src/cli/skill/install-skill';
import { removeTemporaryFolders, sampleSkill, temporaryFolder, writeFiles } from './fixture';

afterEach(removeTemporaryFolders);

const DENIED = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

/** A rename that fails for the moves `fails` picks and does the rest, so a forced install can break at one step. */
function renameFailing(fails: (from: string, to: string) => boolean): (from: string, to: string) => Promise<void> {
	return (from, to) => (fails(from, to) ? Promise.reject(DENIED) : rename(from, to));
}

const publishing = (from: string): boolean => from.includes('-install-');

/** A forced install over an existing skill, with the file-system calls a test wants to fail replaced. */
async function replaceOldSkill(
	skillsFolder: string,
	overrides: Parameters<typeof installSkill>[1]
): ReturnType<typeof installSkill> {
	await writeFiles(skillsFolder, { 'recoder/SKILL.md': 'old\n' });

	return installSkill({ source: await sampleSkill(), skillsFolder, force: true }, overrides);
}

/** The error a failing install rejects with. */
async function failureOf(install: Promise<unknown>): Promise<Error> {
	return install.then(
		() => new Error('the install did not fail'),
		(failure: Error) => failure
	);
}

test('install copies every file of the skill to a recoder folder and counts them', async () => {
	const skillsFolder = join(await temporaryFolder(), 'skills');

	const installed = await installSkill({ source: await sampleSkill(), skillsFolder, force: false });

	expect(installed).toEqual({ destination: join(skillsFolder, 'recoder'), files: 2, warning: null });
	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('skill\n');
	expect(await readFile(join(skillsFolder, 'recoder', 'notes', 'reference.md'), 'utf8')).toBe('reference\n');
});

test('an existing recoder folder is refused and left as it was without force', async () => {
	const skillsFolder = await temporaryFolder();

	await writeFiles(skillsFolder, { 'recoder/SKILL.md': 'mine\n' });

	const install = installSkill({ source: await sampleSkill(), skillsFolder, force: false });

	await expect(install).rejects.toMatchObject({ exitCode: EXIT.usage, message: expect.stringContaining('--force') });
	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('mine\n');
	expect(await readdir(skillsFolder)).toEqual(['recoder']);
});

test('force replaces the recoder folder, so files that only the old one had are gone', async () => {
	const skillsFolder = await temporaryFolder();

	await writeFiles(skillsFolder, { 'recoder/SKILL.md': 'old\n', 'recoder/stale.md': 'stale\n' });

	await installSkill({ source: await sampleSkill(), skillsFolder, force: true });

	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('skill\n');
	expect(existsSync(join(skillsFolder, 'recoder', 'stale.md'))).toBe(false);
	expect(await readdir(skillsFolder)).toEqual(['recoder']);
});

test('a destination that is a symbolic link is refused, even with force, and its target is untouched', async () => {
	const root = await temporaryFolder();
	const skillsFolder = join(root, 'skills');
	const elsewhere = join(root, 'elsewhere');

	await writeFiles(elsewhere, { 'keep.md': 'keep\n' });
	await mkdir(skillsFolder);
	await symlink(elsewhere, join(skillsFolder, 'recoder'));

	const install = installSkill({ source: await sampleSkill(), skillsFolder, force: true });

	await expect(install).rejects.toMatchObject({ exitCode: EXIT.usage, message: expect.stringContaining('symbolic') });
	expect(await readdir(elsewhere)).toEqual(['keep.md']);
	expect(await readdir(skillsFolder)).toEqual(['recoder']);
});

test('a forced install leaves a file and a folder beside the recoder folder untouched', async () => {
	const skillsFolder = await temporaryFolder();

	await writeFiles(skillsFolder, { 'recoder/SKILL.md': 'old\n', 'other/SKILL.md': 'other\n', 'notes.md': 'notes\n' });

	await installSkill({ source: await sampleSkill(), skillsFolder, force: true });

	expect(await readFile(join(skillsFolder, 'other', 'SKILL.md'), 'utf8')).toBe('other\n');
	expect(await readFile(join(skillsFolder, 'notes.md'), 'utf8')).toBe('notes\n');
});

test('a recoder entry that is a file is not replaced, even with force', async () => {
	const skillsFolder = await temporaryFolder();

	await writeFiles(skillsFolder, { recoder: 'a file\n' });

	const install = installSkill({ source: await sampleSkill(), skillsFolder, force: true });

	await expect(install).rejects.toMatchObject({ exitCode: EXIT.usage });
	expect(await readFile(join(skillsFolder, 'recoder'), 'utf8')).toBe('a file\n');
});

test('a copy that fails leaves no staging folder and keeps the folder it would have replaced', async () => {
	const skillsFolder = await temporaryFolder();

	await writeFiles(skillsFolder, { 'recoder/SKILL.md': 'old\n' });

	const install = installSkill({ source: join(skillsFolder, 'missing'), skillsFolder, force: true });

	await expect(install).rejects.toThrow();
	expect(await readdir(skillsFolder)).toEqual(['recoder']);
	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('old\n');
});

test('a skills folder that is a file is refused', async () => {
	const root = await temporaryFolder();

	await writeFiles(root, { skills: 'a file\n' });

	const install = installSkill({ source: await sampleSkill(), skillsFolder: join(root, 'skills'), force: false });

	await expect(install).rejects.toMatchObject({ exitCode: EXIT.usage });
});

test('a forced install whose publish step fails keeps the old skill and leaves no hidden folder', async () => {
	const skillsFolder = await temporaryFolder();

	const install = replaceOldSkill(skillsFolder, { rename: renameFailing(publishing) });

	await expect(install).rejects.toMatchObject({ message: DENIED.message });
	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('old\n');
	expect(await readdir(skillsFolder)).toEqual(['recoder']);
});

test('when the old folder cannot be moved back the error is the original one and names where it is', async () => {
	const skillsFolder = await temporaryFolder();
	const destination = join(skillsFolder, 'recoder');

	const install = replaceOldSkill(skillsFolder, { rename: renameFailing((_from, to) => to === destination) });

	const error = await failureOf(install);

	const [aside] = await readdir(skillsFolder);

	expect(error.message.startsWith(DENIED.message)).toBe(true);
	expect(error.message).toContain(join(skillsFolder, aside));
	expect(error.cause).toBe(DENIED);
	expect(await readdir(skillsFolder)).toHaveLength(1);
	expect(await readFile(join(skillsFolder, aside, 'SKILL.md'), 'utf8')).toBe('old\n');
});

test('a cleanup that fails as well is added to the original error and does not replace it', async () => {
	const skillsFolder = await temporaryFolder();

	const install = replaceOldSkill(skillsFolder, {
		rename: renameFailing(publishing),
		remove: (path) => (path.includes('-install-') ? Promise.reject(new Error('busy')) : rm(path, { recursive: true }))
	});

	const error = await failureOf(install);

	expect(error.message.startsWith(DENIED.message)).toBe(true);
	expect(error.message).toContain('busy');
	expect(error.cause).toBe(DENIED);
	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('old\n');
});

test('an old folder that cannot be removed after a successful forced install is a warning that names it', async () => {
	const skillsFolder = await temporaryFolder();

	const installed = await replaceOldSkill(skillsFolder, {
		remove: (path) => (path.includes('-replaced-') ? Promise.reject(new Error('busy')) : rm(path, { recursive: true }))
	});

	const leftovers = (await readdir(skillsFolder)).filter((name) => name !== 'recoder');

	expect(await readFile(join(skillsFolder, 'recoder', 'SKILL.md'), 'utf8')).toBe('skill\n');
	expect(leftovers).toHaveLength(1);
	expect(installed.warning).toContain(join(skillsFolder, leftovers[0]));
});
