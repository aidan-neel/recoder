import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { execUnavailableReason, runSandboxed, sandboxLayout, type SandboxLayout } from '../../src/sandbox/exec-sandbox';
import { admitCommand, resolveLimits, withSandboxTier } from '../../src/sandbox/host-load';

let base = '';
let layout: SandboxLayout;
const available = process.platform === 'linux' && (await execUnavailableReason()) === null;

beforeAll(async () => {
	base = await mkdtemp(join(import.meta.dir, '.host-load-test-'));
	await mkdir(join(base, 'work/repos/pr-1/.git'), { recursive: true });
	layout = sandboxLayout(join(base, 'work/repos/pr-1'), { workDir: join(base, 'work') });
});

afterAll(async () => {
	if (base) await rm(base, { recursive: true, force: true });
});

test.skipIf(!available)(
	'a sandboxed command is the first to be OOM-killed and runs at the lowest nice level',
	async () => {
		const result = await runSandboxed(layout, 'cat /proc/self/oom_score_adj; nice', { timeoutMs: 10_000 });

		expect(result.output.split('\n').slice(0, 2)).toEqual(['1000', '19']);
	}
);

test.skipIf(!available)('the timeout does not count the time a command waits for a slot', async () => {
	const { runSlots } = resolveLimits(availableParallelism(), process.env);
	const held = await Promise.all(Array.from({ length: runSlots }, () => admitCommand('run')));

	setTimeout(() => held.forEach((release) => release!()), 600);

	const result = await runSandboxed(layout, 'echo done', { timeoutMs: 400 });

	expect(result.timedOut).toBe(false);
	expect(result.output.trim()).toBe('done');
	expect(result.elapsedMs).toBeLessThan(400);
});

test('commands started inside withSandboxTier keep the tier through awaited promise chains', async () => {
	const { prepSlots } = resolveLimits(availableParallelism(), process.env);
	const held = await Promise.all(Array.from({ length: prepSlots }, () => admitCommand('prep')));
	const controller = new AbortController();

	const tagged = withSandboxTier('prep', async () => {
		await Promise.resolve().then(() => undefined);

		return runSandboxed(layout, 'true', { timeoutMs: 1_000, signal: controller.signal });
	});

	const plain = await runSandboxed(layout, 'true', { timeoutMs: 1_000 });

	controller.abort();

	expect((await tagged).output).toContain('stopped while waiting');
	expect(plain.output).not.toContain('stopped while waiting');

	held.forEach((release) => release!());
});
