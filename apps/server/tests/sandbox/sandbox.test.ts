import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUnifiedDiff } from '@recoder/shared';
import { existsSync } from 'node:fs';
import { locateRepo, refspecFor } from '../../src/forge/providers';
import { prepareSandbox, sandboxDiff, sandboxLocation } from '../../src/sandbox/sandbox';
import { git } from '../helpers/git';
import { localForgeFixture } from '../helpers/local-forge';

test('local review checks out PR refs and retains over 300 files and 200KB of diff', async () => {
	const origin = await mkdtemp(join(tmpdir(), 'recoder-origin-'));

	git(origin, ['init', '-b', 'main']);
	git(origin, ['config', 'user.name', 'Test']);
	git(origin, ['config', 'user.email', 'test@example.com']);
	await writeFile(join(origin, 'base.txt'), 'base\n');
	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'base']);
	git(origin, ['checkout', '-b', 'feature']);

	await Promise.all(
		Array.from({ length: 301 }, (_, i) =>
			writeFile(join(origin, 'file-' + i + '.ts'), 'export const value = "' + 'x'.repeat(800) + '";\n')
		)
	);

	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'large PR']);

	const head = git(origin, ['rev-parse', 'HEAD']);

	git(origin, ['update-ref', 'refs/pull/7/head', head]);
	git(origin, ['checkout', 'main']);
	await writeFile(join(origin, 'base-only.txt'), 'not part of the PR\n');
	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'base advanced']);

	const opts = {
		repoSlug: 'test/local',
		repoUrl: origin,
		prNumber: 7,
		fetchRef: 'refs/pull/7/head:pr-7',
		branch: 'pr-7',
		expectedHeadSha: head
	};

	const first = await prepareSandbox({ ...opts, reviewId: crypto.randomUUID() });
	const second = await prepareSandbox({ ...opts, reviewId: crypto.randomUUID() });

	expect(first.path).not.toBe(second.path);
	expect(first.headSha).toBe(head);

	const diff = await sandboxDiff(first.path, 'main');

	expect(diff.length).toBeGreaterThan(200_000);
	expect(parseUnifiedDiff(diff)).toHaveLength(301);
	expect(diff).not.toContain('base-only.txt');
});

test('a local repo PR checks out from its file:// URL at the head, without the metadata file', async () => {
	const { repo, pull7Head } = await localForgeFixture();
	const { provider, slug } = locateRepo(repo.url);

	const sandbox = await prepareSandbox({
		repoSlug: slug,
		prNumber: 7,
		repoUrl: repo.url,
		...refspecFor(provider, 7),
		reviewId: crypto.randomUUID(),
		provider,
		expectedHeadSha: pull7Head
	});

	expect(provider).toBe('local');
	expect(sandbox.headSha).toBe(pull7Head);
	expect(existsSync(join(sandbox.path, '.git', 'recoder-forge.json'))).toBe(false);
});

test('a stopped preparation runs no further git command and fetches nothing', async () => {
	const forge = await localForgeFixture();
	const located = locateRepo(forge.repo.url);
	const controller = new AbortController();
	const reviewId = crypto.randomUUID();

	const stopAtFetch = (message: string) => {
		if (message.startsWith('Fetching')) controller.abort();
	};

	const preparing = prepareSandbox({
		repoSlug: located.slug,
		prNumber: 7,
		repoUrl: forge.repo.url,
		...refspecFor(located.provider, 7),
		reviewId,
		provider: located.provider,
		onProgress: stopAtFetch,
		signal: controller.signal
	});

	const checkout = sandboxLocation(located.slug, 7, reviewId).path;

	await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
	expect(existsSync(join(checkout, '.git', 'FETCH_HEAD'))).toBe(false);

	await Promise.all([checkout, fileURLToPath(forge.repo.url)].map((dir) => rm(dir, { recursive: true, force: true })));
});
