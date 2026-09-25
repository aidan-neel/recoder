import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execUnavailableReason, sandboxLayout } from './exec-sandbox';
import { ExecWorkspace } from './exec-workspace';

const available = (await execUnavailableReason()) === null;
const bases: string[] = [];
afterEach(async () => {
	for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
});

/** A one-commit repo under a fake work dir, outside /tmp so hiding is observable. */
async function workspace(): Promise<{ ws: ExecWorkspace; checkout: string; base: string }> {
	const base = await mkdtemp(join(import.meta.dir, '.workspace-test-'));
	bases.push(base);
	const checkout = join(base, 'work/repos/pr-1');
	await mkdir(checkout, { recursive: true });
	const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: checkout, stdout: 'pipe' }).stdout.toString().trim();
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	await writeFile(join(checkout, 'a.txt'), 'original\n');
	git('add', '.');
	git('commit', '-q', '-m', 'base');
	const layout = sandboxLayout(checkout, { home: join(base, 'home'), dataDir: join(base, 'data'), workDir: join(base, 'work') });
	return { ws: new ExecWorkspace(checkout, git('rev-parse', 'HEAD'), layout), checkout, base };
}

test.skipIf(!available)('edits to tracked files are reverted after each command', async () => {
	const { ws, checkout } = await workspace();
	const result = await ws.run('echo changed > a.txt && cat a.txt', 10_000);
	expect(result.output).toContain('changed');
	expect(await readFile(join(checkout, 'a.txt'), 'utf8')).toBe('original\n');
});

test.skipIf(!available)('writeFile refuses tracked paths', async () => {
	const { ws, checkout } = await workspace();
	expect(await ws.writeFile('a.txt', 'overwritten')).toEqual({ ok: false, error: expect.stringContaining('tracked') });
	expect(await readFile(join(checkout, 'a.txt'), 'utf8')).toBe('original\n');
});

test.skipIf(!available)('writeFile cannot follow a planted symlink out of the checkout', async () => {
	const { ws, checkout, base } = await workspace();
	await mkdir(join(base, 'outside'));
	await symlink(join(base, 'outside'), join(checkout, 'link'));
	const written = await ws.writeFile('link/escape.txt', 'escaped');
	expect(written.ok).toBe(false);
	expect(existsSync(join(base, 'outside/escape.txt'))).toBe(false);
});

test.skipIf(!available)('cleanup removes scratch files the review wrote', async () => {
	const { ws, checkout } = await workspace();
	expect(await ws.writeFile('src/recoder-repro.test.ts', 'test')).toEqual({ ok: true });
	expect(existsSync(join(checkout, 'src/recoder-repro.test.ts'))).toBe(true);
	await ws.cleanup();
	expect(existsSync(join(checkout, 'src/recoder-repro.test.ts'))).toBe(false);
	expect(await readFile(join(checkout, 'a.txt'), 'utf8')).toBe('original\n');
});
