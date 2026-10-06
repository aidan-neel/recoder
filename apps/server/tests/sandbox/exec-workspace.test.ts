import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execUnavailableReason, sandboxLayout } from '../../src/sandbox/exec-sandbox';
import { ExecWorkspace } from '../../src/sandbox/exec-workspace';

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

	const git = (...args: string[]) =>
		Bun.spawnSync(['git', ...args], { cwd: checkout, stdout: 'pipe' })
			.stdout.toString()
			.trim();

	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'test@example.com');
	git('config', 'user.name', 'Test');
	await writeFile(join(checkout, 'a.txt'), 'original\n');
	git('add', '.');
	git('commit', '-q', '-m', 'base');

	const layout = sandboxLayout(checkout, {
		home: join(base, 'home'),
		dataDir: join(base, 'data'),
		workDir: join(base, 'work')
	});

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

test.skipIf(!available)("a scratch file written by one agent is not visible to another agent's run", async () => {
	const { ws, checkout } = await workspace();

	expect(await ws.writeFile('src/recoder-repro.test.ts', 'from a', undefined, 'a')).toEqual({ ok: true });
	expect(await ws.writeFile('src/recoder-repro.test.ts', 'from b', undefined, 'b')).toEqual({ ok: true });

	expect((await ws.run('cat src/recoder-repro.test.ts', 10_000, undefined, 'a')).output).toBe('from a');
	expect((await ws.run('cat src/recoder-repro.test.ts', 10_000, undefined, 'b')).output).toBe('from b');
	expect((await ws.run('test -e src/recoder-repro.test.ts', 10_000, undefined, 'c')).exitCode).toBe(1);
	expect(existsSync(join(checkout, 'src/recoder-repro.test.ts'))).toBe(false);
});

test.skipIf(!available)('writeFile refuses an untracked file already in the checkout', async () => {
	const { ws, checkout } = await workspace();

	await writeFile(join(checkout, 'installed.js'), 'dependency');

	expect(await ws.writeFile('installed.js', 'scratch')).toEqual({
		ok: false,
		error: expect.stringContaining('exists')
	});

	await ws.run('true', 10_000);
	expect(await readFile(join(checkout, 'installed.js'), 'utf8')).toBe('dependency');
});

test.skipIf(!available)('a call whose review aborted while it waited in the queue is skipped, not run', async () => {
	const { ws, checkout } = await workspace();
	const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: checkout }).stdout.toString().trim();
	const controller = new AbortController();
	const first = ws.run('sleep 0.3', 10_000);
	const queued = ws.run('touch ran.txt', 10_000, controller.signal);
	const written = ws.writeFile('scratch.txt', 'x', controller.signal);
	const onBase = ws.runOnBase('touch base-ran.txt', head, 10_000, controller.signal);

	await Bun.sleep(50);
	controller.abort();

	expect(await queued).toMatchObject({ exitCode: null, output: 'Not run: the review was aborted.' });
	expect(await written).toEqual({ ok: false, error: 'Not run: the review was aborted.' });
	expect(await onBase).toEqual({ unavailable: 'Not run: the review was aborted.' });
	expect((await first).exitCode).toBe(0);
	expect(existsSync(join(checkout, 'ran.txt'))).toBe(false);
});
