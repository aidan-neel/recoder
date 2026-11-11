import { afterEach, expect, test } from 'bun:test';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createGuidelinesStep } from '../../../src/cli/init/guidelines-step';
import { registerMcpStep } from '../../../src/cli/init/mcp-step';
import { installSkillStep } from '../../../src/cli/init/skill-step';
import { hasRules } from '../../../src/review/guidelines/guidelines';
import { removeTemporaryFolders, temporaryFolder, writeFiles } from '../skill/fixture';

afterEach(removeTemporaryFolders);

const never = async (): Promise<boolean> => false;

const always = async (): Promise<boolean> => true;

/** Installs the skill for Claude Code into `skillsFolder`, replacing one that differs only when `shouldReplace` agrees. */
function installInto(skillsFolder: string, shouldReplace = never) {
	return installSkillStep({ agent: 'claude', skillsFolder, shouldReplace });
}

test('the skill is installed where there is none, and found up to date the second time', async () => {
	const skills = join(await temporaryFolder(), 'skills');

	expect(await installInto(skills)).toMatchObject({ state: 'done', path: join(skills, 'recoder') });
	expect(await installInto(skills)).toMatchObject({ state: 'unchanged' });
	expect(existsSync(join(skills, 'recoder', 'SKILL.md'))).toBe(true);
});

test('a skill that differs is left alone unless replacing it is agreed to', async () => {
	const skills = join(await temporaryFolder(), 'skills');

	await writeFiles(skills, { 'recoder/SKILL.md': 'edited by hand\n' });

	expect(await installInto(skills, never)).toMatchObject({ state: 'skipped' });
	expect(readFileSync(join(skills, 'recoder', 'SKILL.md'), 'utf8')).toBe('edited by hand\n');

	expect(await installInto(skills, always)).toMatchObject({ state: 'done' });
	expect(readFileSync(join(skills, 'recoder', 'SKILL.md'), 'utf8')).not.toBe('edited by hand\n');
});

test('a skill folder that is a symbolic link fails the step and is not written through', async () => {
	const folder = await temporaryFolder();
	const elsewhere = join(folder, 'elsewhere');

	await writeFiles(folder, { 'elsewhere/keep.md': 'keep\n', 'skills/.keep': '' });
	symlinkSync(elsewhere, join(folder, 'skills', 'recoder'));

	expect(await installInto(join(folder, 'skills'), always)).toMatchObject({ state: 'failed' });
	expect(existsSync(join(elsewhere, 'SKILL.md'))).toBe(false);
});

test('a project with no guidelines file gets a RECODER.md that holds no rules yet', async () => {
	const project = await temporaryFolder();

	expect(await createGuidelinesStep(project)).toMatchObject({ state: 'done', path: join(project, 'RECODER.md') });
	expect(hasRules(readFileSync(join(project, 'RECODER.md'), 'utf8'))).toBe(false);
});

test.each(['RECODER.md', '.recoder/REVIEW.md'])('a project that has %s keeps it untouched', async (path) => {
	const project = await temporaryFolder();

	await writeFiles(project, { [path]: '- Our rule.\n' });

	expect(await createGuidelinesStep(project)).toMatchObject({ state: 'unchanged', path: join(project, path) });
	expect(readFileSync(join(project, path), 'utf8')).toBe('- Our rule.\n');
	expect(existsSync(join(project, 'RECODER.md'))).toBe(path === 'RECODER.md');
});

const readMcpConfig = (project: string) => JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf8'));

test('the MCP server is added beside the servers and fields .mcp.json already has', async () => {
	const project = await temporaryFolder();
	const existing = { mcpServers: { other: { command: 'other' } }, note: 'kept' };

	await writeFiles(project, { '.mcp.json': JSON.stringify(existing) });

	expect(await registerMcpStep(project, false)).toMatchObject({ state: 'done' });

	expect(readMcpConfig(project)).toEqual({
		mcpServers: { other: { command: 'other' }, recoder: { command: 'recoder', args: ['mcp'] } },
		note: 'kept'
	});

	expect(await registerMcpStep(project, false)).toMatchObject({ state: 'unchanged' });
});

test('a recoder server that differs is replaced only with force', async () => {
	const project = await temporaryFolder();

	await writeFiles(project, { '.mcp.json': JSON.stringify({ mcpServers: { recoder: { command: 'mine' } } }) });

	expect(await registerMcpStep(project, false)).toMatchObject({ state: 'skipped' });
	expect(readMcpConfig(project).mcpServers.recoder).toEqual({ command: 'mine' });

	expect(await registerMcpStep(project, true)).toMatchObject({ state: 'done' });
	expect(readMcpConfig(project).mcpServers.recoder).toEqual({ command: 'recoder', args: ['mcp'] });
});

test.each(['{ not json', '[]', '{"mcpServers": 3}'])(
	'an .mcp.json holding %s fails the step and is not overwritten',
	async (text) => {
		const project = await temporaryFolder();

		await writeFiles(project, { '.mcp.json': text });

		expect(await registerMcpStep(project, true)).toMatchObject({ state: 'failed' });
		expect(readFileSync(join(project, '.mcp.json'), 'utf8')).toBe(text);
	}
);
