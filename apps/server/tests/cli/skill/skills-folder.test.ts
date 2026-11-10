import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { resolveSkillsFolder, type SkillAgent, type SkillScope } from '../../../src/cli/skill/skills-folder';

const ROOTS = { workingDirectory: '/work/project', homeDirectory: '/home/person' };

const FOLDERS: [SkillAgent, SkillScope, string][] = [
	['claude', 'user', '/home/person/.claude/skills'],
	['claude', 'project', '/work/project/.claude/skills'],
	['agents', 'user', '/home/person/.agents/skills'],
	['agents', 'project', '/work/project/.agents/skills']
];

test.each(FOLDERS)('agent %s with scope %s installs into %s', (agent, scope, folder) => {
	expect(resolveSkillsFolder({ agent, scope, dir: null }, ROOTS)).toBe(folder);
});

test('an explicit folder replaces the agent and scope and is measured from the working directory', () => {
	expect(resolveSkillsFolder({ agent: 'claude', scope: 'user', dir: 'tools/skills' }, ROOTS)).toBe(
		'/work/project/tools/skills'
	);
});

test('a home directory that is not absolute is refused for the user scope, and --dir still works', () => {
	const roots = { ...ROOTS, homeDirectory: '.' };
	const resolveUserFolder = (): string => resolveSkillsFolder({ agent: 'claude', scope: 'user', dir: null }, roots);

	expect(resolveUserFolder).toThrow(expect.objectContaining({ exitCode: EXIT.notReady }));
	expect(resolveSkillsFolder({ agent: 'claude', scope: 'user', dir: 'skills' }, roots)).toBe('/work/project/skills');
});
