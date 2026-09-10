import { expect, test } from 'bun:test';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory } from './inventory';
import { EvidenceStore, sanitizeRepoPath } from './evidence';

function git(cwd: string, args: string[]): string {
	const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

test('sanitizeRepoPath rejects escapes and absolute paths', () => {
	expect(sanitizeRepoPath('../secret')).toBeNull();
	expect(sanitizeRepoPath('/etc/passwd')).toBeNull();
	expect(sanitizeRepoPath('src/app.ts')).toBe('src/app.ts');
});

test('readFile can retrieve late lines without truncating the file head', async () => {
	const origin = await mkdtemp(join(tmpdir(), 'recoder-ev-'));
	git(origin, ['init', '-b', 'main']);
	git(origin, ['config', 'user.name', 'Test']);
	git(origin, ['config', 'user.email', 'test@example.com']);
	const lines = Array.from({ length: 400 }, (_, i) => `line-${i + 1}`);
	await writeFile(join(origin, 'big.ts'), lines.join('\n') + '\n');
	git(origin, ['add', '.']);
	git(origin, ['commit', '-m', 'big']);
	const sha = git(origin, ['rev-parse', 'HEAD']);
	const store = new EvidenceStore(
		{ checkoutPath: origin, headSha: sha, targetSha: sha, mergeBaseSha: sha, targetRef: 'main' },
		buildInventory(''),
		20_000
	);
	const [result] = await store.executeRound([{ action: 'readFile', revision: 'head', path: 'big.ts', startLine: 350, endLine: 355 }]);
	expect(result.ok).toBe(true);
	expect(result.content).toContain('350|line-350');
	expect(result.content).not.toContain('line-1');
	expect(result.evidenceId).toMatch(/^ev_/);
});

test('readFile refuses symlinks and unknown revisions', async () => {
	const origin = await mkdtemp(join(tmpdir(), 'recoder-link-'));
	git(origin, ['init', '-b', 'main']);
	git(origin, ['config', 'user.name', 'Test']);
	git(origin, ['config', 'user.email', 'test@example.com']);
	await writeFile(join(origin, 'ok.ts'), 'ok\n');
	await symlink('/etc/passwd', join(origin, 'link.ts'));
	git(origin, ['add', '-f', '.']);
	git(origin, ['commit', '-m', 'link']);
	const sha = git(origin, ['rev-parse', 'HEAD']);
	const store = new EvidenceStore(
		{ checkoutPath: origin, headSha: sha, targetSha: sha, mergeBaseSha: sha, targetRef: 'main' },
		buildInventory(''),
		20_000
	);
	const [symlinkRead] = await store.executeRound([{ action: 'readFile', revision: 'head', path: 'link.ts', startLine: 1, endLine: 10 }]);
	expect(symlinkRead.ok).toBe(false);
	expect(symlinkRead.error).toMatch(/symlink/i);
	const [badRev] = await store.executeRound([{ action: 'readFile', revision: 'abc123', path: 'ok.ts', startLine: 1, endLine: 10 }]);
	expect(badRev.ok).toBe(false);
});
