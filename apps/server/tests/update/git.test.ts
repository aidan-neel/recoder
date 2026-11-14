import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitCheckout } from '../../src/update/git';
import { commitAll, git } from '../helpers/git';
import { makeCheckout, upstreamCommit } from './fixture';

describe('gitCheckout.inspect', () => {
	test('reports the branch, upstream and nothing pending on a clean, current checkout', async () => {
		const { root } = await makeCheckout();
		const inspection = await gitCheckout(root).inspect();

		expect(inspection.branch).toBe('main');
		expect(inspection.upstream).toBe('origin/main');
		expect(inspection.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(inspection).toMatchObject({ ahead: 0, behind: 0, commits: [], paths: [], dirtyPaths: [] });
	});

	test('lists the commits and changed paths between HEAD and upstream after a fetch', async () => {
		const { source, root } = await makeCheckout();

		await upstreamCommit(source, { 'apps/server/src/new.ts': 'export const x = 1;\n' }, 'add a server file');
		await upstreamCommit(source, { 'apps/app/next.tsx': 'export {};\n' }, 'add an app file');

		const repo = gitCheckout(root);

		await repo.fetch();

		const inspection = await repo.inspect();

		expect(inspection.behind).toBe(2);
		expect(inspection.ahead).toBe(0);
		expect(inspection.commits.map((commit) => commit.subject)).toEqual(['add an app file', 'add a server file']);
		expect(inspection.paths).toEqual(['apps/app/next.tsx', 'apps/server/src/new.ts']);
	});

	test('counts uncommitted and untracked paths as dirty', async () => {
		const { root } = await makeCheckout();

		await writeFile(join(root, 'apps/server/src/index.ts'), 'changed\n');
		await writeFile(join(root, 'untracked.txt'), 'new\n');

		expect((await gitCheckout(root).inspect()).dirtyPaths).toHaveLength(2);
	});

	test('counts a checkout both ahead and behind as diverged', async () => {
		const { source, root } = await makeCheckout();

		await upstreamCommit(source, { 'apps/web/src/added.ts': 'export {};\n' });
		await writeFile(join(root, 'local.txt'), 'mine\n');
		commitAll(root, 'local work');
		await gitCheckout(root).fetch();

		const inspection = await gitCheckout(root).inspect();

		expect(inspection).toMatchObject({ ahead: 1, behind: 1 });
	});

	test('mergeFfOnly advances HEAD to upstream', async () => {
		const { source, root } = await makeCheckout();

		await upstreamCommit(source, { 'apps/server/src/index.ts': 'updated\n' });

		const repo = gitCheckout(root);

		await repo.fetch();
		await repo.mergeFfOnly();

		expect((await repo.inspect()).behind).toBe(0);
		expect(git(root, ['log', '-1', '--format=%s'])).toBe('upstream change');
	});
});
