import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Repo } from '@recoder/shared';
import { git } from './git';

/** A local forge repo and the commits the tests name. */
export interface LocalForgeFixture {
	repo: Repo;
	/** The first commit on main, below every pull. */
	root: string;
	/** PR #3's own commit, on its head ref only. */
	pull3Commit: string;
	/** PR #3 squash-merged onto main as `Add helper (#3)`. */
	squash: string;
	/** PR #7's first commit, which edits `a.ts`. */
	pull7Commit: string;
	/** PR #7's head, which renames `old.ts` to `new.ts`. */
	pull7Head: string;
}

async function commit(dir: string, files: Record<string, string>, message: string): Promise<string> {
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-m', message]);

	return git(dir, ['rev-parse', 'HEAD']);
}

/**
 * A repo laid out like a GitHub one: merged PR #3 (squashed onto main) and
 * open PR #7 on top of it, each with `refs/pull/N/head`, plus the metadata
 * file in the git dir. PR #7 closes issue #5 and has a review thread.
 */
export async function localForgeFixture(): Promise<LocalForgeFixture> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-local-forge-'));

	git(dir, ['init', '-b', 'main']);

	const root = await commit(dir, { 'a.ts': 'one\ntwo\nthree\n', 'old.ts': 'keep\n' }, 'init');

	git(dir, ['checkout', '-b', 'helper']);

	const pull3Commit = await commit(dir, { 'helper.ts': 'export {}\n' }, 'Write helper');

	git(dir, ['update-ref', 'refs/pull/3/head', pull3Commit]);
	git(dir, ['checkout', 'main']);

	const squash = await commit(dir, { 'helper.ts': 'export {}\n' }, 'Add helper (#3)');

	git(dir, ['checkout', '-b', 'feature']);

	const pull7Commit = await commit(dir, { 'a.ts': 'one\nTWO\nthree\nfour\n' }, 'Change a\n\nSee #5');

	git(dir, ['mv', 'old.ts', 'new.ts']);
	git(dir, ['commit', '-m', 'Rename old']);

	const pull7Head = git(dir, ['rev-parse', 'HEAD']);

	git(dir, ['update-ref', 'refs/pull/7/head', pull7Head]);
	git(dir, ['checkout', 'main']);

	const comment = (author: string, body: string, createdAt: string) => ({ author, body, createdAt });

	const forge = {
		defaultBranch: 'main',
		pulls: [
			{
				number: 3,
				title: 'Add helper',
				body: 'Adds the helper.',
				author: 'al',
				createdAt: '2026-01-01T00:00:00Z',
				state: 'merged',
				headRef: 'helper',
				baseRef: 'main',
				baseSha: root
			},
			{
				number: 7,
				title: 'Change a',
				body: 'Makes two loud. Closes #5.',
				author: 'bo',
				createdAt: '2026-01-02T00:00:00Z',
				state: 'open',
				headRef: 'feature',
				baseRef: 'main',
				baseSha: squash,
				reviewers: ['al'],
				labels: ['bug'],
				closes: [5],
				comments: [comment('al', 'Looks fine overall.', '2026-01-03T00:00:00Z')],
				threads: [{ path: 'a.ts', line: 2, comments: [comment('al', 'Why upper case?', '2026-01-03T01:00:00Z')] }]
			}
		],
		issues: [
			{
				number: 5,
				title: 'Two is too quiet',
				body: 'Nobody notices two.',
				author: 'cy',
				createdAt: '2025-12-30T00:00:00Z',
				state: 'open',
				comments: [comment('bo', 'I will make it loud.', '2025-12-31T00:00:00Z')]
			}
		]
	};

	await writeFile(join(git(dir, ['rev-parse', '--absolute-git-dir']), 'recoder-forge.json'), JSON.stringify(forge));

	const repo: Repo = {
		id: crypto.randomUUID(),
		name: 'local',
		url: pathToFileURL(dir).href,
		provider: 'local',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};

	return { repo, root, pull3Commit, squash, pull7Commit, pull7Head };
}
