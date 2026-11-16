import { afterEach, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillSummary } from '@recoder/shared';
import { app } from '../../src/app';
import { db } from '../../src/store';
import { git } from '../helpers/git';
import { localForgeFixture } from '../helpers/local-forge';

afterEach(async () => {
	await db.repos.clear();
});

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
	const path = join(dir, '.agents/skills', name, 'SKILL.md');

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`);
}

/** The forge fixture with `shared` and `main-only` on main, and `shared` changed and `head-only` added on pull 7. */
async function repoWithSkills() {
	const { repo } = await localForgeFixture();
	const dir = fileURLToPath(repo.url);

	await writeSkill(dir, 'shared', 'Main version');
	await writeSkill(dir, 'main-only', 'Only on main');
	git(dir, ['add', '-A']);
	git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'skills']);

	git(dir, ['checkout', '-q', 'feature']);
	await writeSkill(dir, 'shared', 'Head version');
	await writeSkill(dir, 'head-only', 'Only on the head');
	git(dir, ['add', '-A']);
	git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'head skills']);
	git(dir, ['update-ref', 'refs/pull/7/head', 'HEAD']);
	git(dir, ['checkout', '-q', 'main']);

	return db.repos.set(repo);
}

async function skillsOf(path: string): Promise<{ status: number; skills: SkillSummary[] }> {
	const response = await app.request(path);
	const body = (await response.json()) as { skills?: SkillSummary[] };

	return { status: response.status, skills: body.skills ?? [] };
}

test('the skills route lists the default branch, sorted by name', async () => {
	const repo = await repoWithSkills();
	const { status, skills } = await skillsOf(`/api/repos/${repo.id}/skills`);

	expect(status).toBe(200);

	expect(skills.map((skill) => [skill.name, skill.description])).toEqual([
		['main-only', 'Only on main'],
		['shared', 'Main version']
	]);
});

test('with a pull request the head’s skills join the list and win a name clash', async () => {
	const repo = await repoWithSkills();
	const { skills } = await skillsOf(`/api/repos/${repo.id}/skills?pull=7`);

	expect(skills.map((skill) => [skill.name, skill.description])).toEqual([
		['head-only', 'Only on the head'],
		['main-only', 'Only on main'],
		['shared', 'Head version']
	]);
});

test('a pull request the forge cannot find lists the default branch only, and a bad number is refused', async () => {
	const repo = await repoWithSkills();

	expect((await skillsOf(`/api/repos/${repo.id}/skills?pull=99`)).skills.map((skill) => skill.name)).toEqual([
		'main-only',
		'shared'
	]);

	expect((await skillsOf(`/api/repos/${repo.id}/skills?pull=abc`)).status).toBe(400);
});

test('the overview of a repository that is not tracked is not found', async () => {
	const response = await app.request('/api/repos/missing/overview');

	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: 'repo not found' });
});
