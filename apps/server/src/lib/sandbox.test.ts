import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnifiedDiff } from '@recoder/shared';
import { prepareSandbox, sandboxDiff } from './sandbox';

function git(cwd: string, args: string[]): string {
	const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

test('local review checks out PR refs and retains over 300 files and 200KB of diff', async () => {
	const origin = await mkdtemp(join(tmpdir(), 'recoder-origin-'));
	git(origin, ['init', '-b', 'main']);
	git(origin, ['config', 'user.name', 'Test']);
	git(origin, ['config', 'user.email', 'test@example.com']);
	await writeFile(join(origin, 'base.txt'), 'base\n');
	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'base']);
	git(origin, ['checkout', '-b', 'feature']);
	await Promise.all(Array.from({ length: 301 }, (_, i) => writeFile(join(origin, 'file-' + i + '.ts'), 'export const value = "' + 'x'.repeat(800) + '";\n')));
	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'large PR']);
	const head = git(origin, ['rev-parse', 'HEAD']);
	git(origin, ['update-ref', 'refs/pull/7/head', head]);
	git(origin, ['checkout', 'main']);
	await writeFile(join(origin, 'base-only.txt'), 'not part of the PR\n');
	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'base advanced']);
	const opts = { repoSlug: 'test/local', repoUrl: origin, prNumber: 7, fetchRef: 'refs/pull/7/head:pr-7', branch: 'pr-7', expectedHeadSha: head };
	const first = await prepareSandbox({ ...opts, reviewId: crypto.randomUUID() });
	const second = await prepareSandbox({ ...opts, reviewId: crypto.randomUUID() });
	expect(first.path).not.toBe(second.path);
	expect(first.headSha).toBe(head);
	const diff = await sandboxDiff(first.path, 'main');
	expect(diff.length).toBeGreaterThan(200_000);
	expect(parseUnifiedDiff(diff)).toHaveLength(301);
	expect(diff).not.toContain('base-only.txt');
});
