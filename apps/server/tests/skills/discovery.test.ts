import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSkills, listSkills, type SkillRevision } from '../../src/skills/discovery';
import { commitAll, git, useCommittedRepos, writeTree } from '../helpers/git';

const committed = useCommittedRepos('recoder-skills-');

/** A `SKILL.md` with frontmatter. */
function skill(name: string, description: string, body = 'Do the thing.'): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
}

function head(root: string): SkillRevision {
	return { root, sha: git(root, ['rev-parse', 'HEAD']) };
}

test('skills in both folders are listed by name, from their frontmatter or their folder', async () => {
	const root = await committed({
		'.claude/skills/review/SKILL.md': skill('review', 'Review a change'),
		'.agents/skills/deploy/SKILL.md': '# Deploy\n\nShip it.\n',
		'.agents/skills/not-a-skill/README.md': 'no SKILL.md here'
	});

	expect(await listSkills([head(root)])).toEqual([
		{ name: 'deploy', description: '', path: '.agents/skills/deploy/SKILL.md' },
		{ name: 'review', description: 'Review a change', path: '.claude/skills/review/SKILL.md' }
	]);
});

test('a skill folder linked from .claude/skills to .agents/skills is listed once, from the real folder', async () => {
	const root = await committed({ '.agents/skills/giga-ui/SKILL.md': skill('giga-ui', 'Build UI') });

	await writeTree(root, {}, { '.claude/skills/giga-ui': '../../.agents/skills/giga-ui' });
	commitAll(root, 'link');

	expect(await listSkills([head(root)])).toEqual([
		{ name: 'giga-ui', description: 'Build UI', path: '.agents/skills/giga-ui/SKILL.md' }
	]);
});

test('links that lead outside the repository are never read as skills', async () => {
	const outside = await mkdtemp(join(tmpdir(), 'recoder-skills-outside-'));

	try {
		await writeFile(join(outside, 'SKILL.md'), skill('stolen', 'Outside the repo'));

		const root = await committed({ '.agents/skills/real/SKILL.md': skill('real', 'Inside') });

		await writeTree(
			root,
			{},
			{ '.claude/skills/folder-link': outside, '.agents/skills/file-link/SKILL.md': join(outside, 'SKILL.md') }
		);

		commitAll(root, 'links');

		const listed = await listSkills([head(root)]);

		expect(listed.map((item) => item.name)).toEqual(['real']);
		expect((await findSkills([head(root)], ['stolen', 'file-link'])).missing).toEqual(['stolen', 'file-link']);
	} finally {
		await rm(outside, { recursive: true, force: true });
	}
});

test('at most 50 skills are listed', async () => {
	const files: Record<string, string> = {};

	for (let index = 0; index < 60; index++) {
		const name = `skill-${String(index).padStart(2, '0')}`;

		files[`.agents/skills/${name}/SKILL.md`] = skill(name, 'One of many');
	}

	const root = await committed(files);

	expect(await listSkills([head(root)])).toHaveLength(50);
});

test('a skill at the pull request head wins over the target, and a target-only skill is still found', async () => {
	const root = await committed({
		'.agents/skills/shared/SKILL.md': skill('shared', 'Target version', 'Old text'),
		'.agents/skills/target-only/SKILL.md': skill('target-only', 'Only on the target')
	});

	const target = head(root);

	await writeTree(root, {
		'.agents/skills/shared/SKILL.md': skill('shared', 'Head version', 'New text'),
		'.agents/skills/head-only/SKILL.md': skill('head-only', 'Only on the head')
	});

	commitAll(root, 'head');

	const revisions = [head(root), target];
	const listed = await listSkills(revisions);

	expect(listed.map((item) => [item.name, item.description])).toEqual([
		['head-only', 'Only on the head'],
		['shared', 'Head version'],
		['target-only', 'Only on the target']
	]);

	const found = await findSkills(revisions, ['shared', 'target-only', 'missing']);

	expect(found.skills.map((item) => item.name)).toEqual(['shared', 'target-only']);
	expect(found.skills[0].text).toContain('New text');
	expect(found.missing).toEqual(['missing']);
});

test('a SKILL.md longer than 20,000 characters is cut and says so', async () => {
	const root = await committed({ '.agents/skills/long/SKILL.md': skill('long', 'Long', 'y'.repeat(25_000)) });
	const [loaded] = (await findSkills([head(root)], ['long'])).skills;

	expect(loaded.text).toHaveLength(20_000);
	expect(loaded.truncated).toBe(true);
});
