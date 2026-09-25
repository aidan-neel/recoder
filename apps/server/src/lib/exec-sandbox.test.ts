import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execUnavailableReason, runSandboxed, sandboxLayout, type SandboxLayout } from './exec-sandbox';

// Outside /tmp on purpose: the sandbox's /tmp is always a fresh tmpfs, which
// would hide these directories whether or not the layout does its job.
let base = '';
let layout: SandboxLayout;
const available = (await execUnavailableReason()) === null;

beforeAll(async () => {
	base = await mkdtemp(join(import.meta.dir, '.sandbox-test-'));
	await mkdir(join(base, 'home/.ssh'), { recursive: true });
	await writeFile(join(base, 'home/.ssh/id_ed25519'), 'PRIVATE KEY');
	await mkdir(join(base, 'data'), { recursive: true });
	await writeFile(join(base, 'data/tokens.json'), '{"github":"secret"}');
	await mkdir(join(base, 'work/repos/pr-1/.git'), { recursive: true });
	await mkdir(join(base, 'outside'), { recursive: true });
	layout = sandboxLayout(join(base, 'work/repos/pr-1'), { home: join(base, 'home'), dataDir: join(base, 'data'), workDir: join(base, 'work') });
});

afterAll(async () => {
	if (base) await rm(base, { recursive: true, force: true });
});

const run = (command: string, timeoutMs = 10_000) => runSandboxed(layout, command, { timeoutMs });

test.skipIf(!available)('a sandboxed command cannot read the home or data directories', async () => {
	const result = await run(`cat ${join(base, 'home/.ssh/id_ed25519')}; cat ${join(base, 'data/tokens.json')}; echo done`);
	expect(result.output).not.toContain('PRIVATE KEY');
	expect(result.output).not.toContain('secret');
	expect(result.output).toContain('done');
});

test.skipIf(!available)('a sandboxed command can write the checkout but nothing outside it', async () => {
	await run(`echo inside > scratch.txt; echo outside > ${join(base, 'outside/escape.txt')}`);
	expect(await readFile(join(base, 'work/repos/pr-1/scratch.txt'), 'utf8')).toBe('inside\n');
	expect(existsSync(join(base, 'outside/escape.txt'))).toBe(false);
});

test.skipIf(!available)('the checkout .git directory is read-only inside the sandbox', async () => {
	const result = await run('touch .git/HEAD.lock && echo wrote');
	expect(result.output).not.toContain('wrote');
	expect(existsSync(join(base, 'work/repos/pr-1/.git/HEAD.lock'))).toBe(false);
});

test.skipIf(!available)('a sandboxed command has no network', async () => {
	const result = await run('(exec 3<>/dev/tcp/1.1.1.1/53) 2>/dev/null && echo open || echo closed');
	expect(result.output.trim()).toBe('closed');
});

test.skipIf(!available)('a timed-out command is killed along with its background children', async () => {
	const marker = `sleep ${40_000 + Math.floor(Math.random() * 1000)}`;
	const result = await run(`${marker} & ${marker}`, 300);
	expect(result.timedOut).toBe(true);
	expect(result.exitCode).toBeNull();
	await Bun.sleep(200);
	const ps = Bun.spawnSync(['pgrep', '-f', marker]);
	expect(ps.stdout.toString().trim()).toBe('');
});
