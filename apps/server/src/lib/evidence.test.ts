import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory } from './inventory';
import { actionCommand, EvidenceStore, sanitizeRepoPath, type ToolCallReport } from './evidence';

test('retrieval reports terminal errors and observer failures do not alter results', async () => {
	const store = new EvidenceStore(null, buildInventory(''), 20_000);
	const calls: ToolCallReport[] = [];
	const [result] = await store.executeRound([{ action: 'readFile', path: '../secret' }], undefined, (tool) => calls.push(tool));
	expect(result.ok).toBe(false);
	expect(calls.map((call) => call.status)).toEqual(['running', 'error']);
	expect(calls[0].id).toBe(calls[1].id);
	expect(calls[1].exitCode).toBeNull();
	expect(calls[1].finishedAt).toBeDefined();
	expect(calls[1].input).toEqual({ action: 'readFile', path: '../secret' });
	expect(calls[1].result).toMatchObject({ content: '', error: 'invalid path' });
	const [again] = await store.executeRound([{ action: 'readFile', path: '../secret' }], undefined, () => { throw new Error('observer'); });
	expect(again).toEqual(result);
});

test('tool previews preserve evidence and bounded output across repeated retrievals', async () => {
	const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+${'x'.repeat(20_000)}\n`;
	const store = new EvidenceStore(null, buildInventory(diff), 24_000);
	const calls: ToolCallReport[] = [];
	const actions = [{ action: 'readDiff', path: 'a.ts' }];
	const [result] = await store.executeRound(actions, undefined, (tool) => calls.push(tool));
	await store.executeRound(actions, undefined, (tool) => calls.push(tool));
	expect(calls.map((call) => call.status)).toEqual(['running', 'done', 'running', 'done']);
	expect(calls[0].id).not.toBe(calls[2].id);
	expect(calls[1].result?.evidenceId).toBe(result.evidenceId);
	expect(calls[1].result?.content).toBe(result.content.slice(0, 12_000));
	expect(calls[1].result?.truncated).toBe(true);
	expect(calls[3].result).toEqual(calls[1].result);
	expect(actionCommand({ action: 'search', query: 'needle', prefix: 'src/lib' })).toBe('search "needle" src/lib');
});

test('a scoped round reads every file past the per-turn limit and credits no hunks it cut entirely', async () => {
	const file = (name: string, size: number) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+${'x'.repeat(size)}\n`;
	const names = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
	const twoHunks = 'diff --git a/two.ts b/two.ts\n--- a/two.ts\n+++ b/two.ts\n@@ -1 +1 @@\n-old\n+new\n@@ -20 +20 @@\n-old\n+new\n';
	const store = new EvidenceStore(null, buildInventory([...names.map((name) => file(name, 10)), file('big.ts', 30_000), twoHunks].join('')), 24_000);
	const limited = await store.executeRound(names.map((path) => ({ action: 'readDiff', path })));
	expect(limited).toHaveLength(4);
	const scoped = await store.executeRound([...names, 'big.ts', 'late.ts'].map((path) => ({ action: 'readDiff', path })), undefined, undefined, 8);
	expect(scoped.map((result) => result.path)).toEqual([...names, 'big.ts', undefined]);
	expect(scoped.slice(0, 6).every((result) => result.ok && result.hunkIds?.length === 1)).toBe(true);
	expect(scoped[6]).toMatchObject({ truncated: true });
	const cut = await store.executeRound([{ action: 'readDiff', path: 'big.ts' }, { action: 'readDiff', path: 'two.ts' }], undefined, undefined, 2);
	expect(cut[1]).toMatchObject({ content: '', truncated: true, hunkIds: [] });
});

test('malformed retrievals still report a display command and preserve their failure details', async () => {
	const store = new EvidenceStore(null, buildInventory(''), 20_000);
	const calls: ToolCallReport[] = [];
	const input = { type: 'deleteFile', path: 'packages/sivir/cli/commands/status.ts' };
	const results = await store.executeRound([input, { action: 42 }], undefined, (tool) => calls.push(tool));
	expect(results.every((result) => !result.ok)).toBe(true);
	expect(calls.map((call) => call.command)).toEqual(['Unknown tool', 'Unknown tool', 'Unknown tool', 'Unknown tool']);
	expect(calls[1]).toMatchObject({ status: 'error', input, summary: expect.stringContaining('unsupported action'), result: { error: expect.stringContaining('Use exactly one of') } });
	expect(JSON.parse(JSON.stringify(calls[1])).command).toBe('Unknown tool');
});

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

test('optional file discovery uses the requested revision and skips missing files and symlinks', async () => {
	const root = await mkdtemp(join(tmpdir(), 'recoder-guidance-'));
	try {
		git(root, ['init', '-b', 'main']);
		git(root, ['config', 'user.name', 'Test']);
		git(root, ['config', 'user.email', 'test@example.com']);
		await mkdir(join(root, 'docs'));
		await writeFile(join(root, 'AGENTS.md'), 'Base guidance');
		await writeFile(join(root, 'docs/CONTRIBUTING.md'), 'Contribution guidance');
		await symlink('AGENTS.md', join(root, 'CLAUDE.md'));
		git(root, ['add', '.']);
		git(root, ['commit', '-m', 'base']);
		const targetSha = git(root, ['rev-parse', 'HEAD']);
		await writeFile(join(root, 'CONTRIBUTING.md'), 'Only on head');
		git(root, ['add', '.']);
		git(root, ['commit', '-m', 'head']);
		const headSha = git(root, ['rev-parse', 'HEAD']);
		const store = new EvidenceStore({ checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }, buildInventory(''), 20_000);
		const paths = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
		expect(await store.existingFiles('target', paths)).toEqual(['AGENTS.md', 'docs/CONTRIBUTING.md']);
		expect(await store.existingFiles('head', paths)).toEqual(['AGENTS.md', 'CONTRIBUTING.md', 'docs/CONTRIBUTING.md']);
		const [missing] = await store.executeRound([{ action: 'readFile', revision: 'target', path: 'CONTRIBUTING.md' }]);
		expect(missing.ok).toBe(false);
		expect(missing.error).toContain('path not found');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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
