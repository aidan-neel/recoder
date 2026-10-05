import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { runBaselineChecks } from '../../../../src/review/pipeline/harness/baseline-run';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';
import { execUnavailableReason } from '../../../../src/sandbox/exec-sandbox';
import { removeOverlayDirs } from '../../../../src/sandbox/overlay';
import { baselineCacheDir } from '../../../../src/review/pipeline/harness/baseline-cache';
import { sharedInstallFixture, type SharedInstallFixture } from '../../../helpers/shared-install';

const available = (await execUnavailableReason()) === null;

/** Counts its own runs in a file in the checkout, and prints a different line every run, so a replay is told from a rerun. */
const CHECKER = `#!/bin/sh
echo run >> calls
echo "checked $(date +%s%N) $*"
exit \${CHECKER_EXIT:-0}
`;

let fx: SharedInstallFixture | null = null;

beforeEach(async () => {
	await rm(baselineCacheDir(), { recursive: true, force: true });
});

afterEach(async () => {
	if (fx) await removeOverlayDirs(fx.base);

	fx = null;
});

/** A review of the fixture repo that has installed, with a `checker` command on PATH. */
async function review(name: string, edit?: (checkout: string) => Promise<void> | void) {
	fx ??= await sharedInstallFixture();

	const made = await fx.review(name, edit);

	await writeFile(join(fx.base, 'bin/checker'), CHECKER);
	await chmod(join(fx.base, 'bin/checker'), 0o755);

	const report = await made.workspace.setup();
	const evidence = new EvidenceStore(null, buildInventory(''), 1000);

	evidence.exec = made.workspace;

	return { ...made, evidence, report };
}

const checks = (made: Awaited<ReturnType<typeof review>>, commands: string[], cache = true) =>
	runBaselineChecks(commands, {
		evidence: made.evidence,
		workspace: made.workspace,
		report: made.report,
		signal: new AbortController().signal,
		cache
	});

const calls = (made: { checkout: string }) => existsSync(join(made.checkout, 'calls'));

test.skipIf(!available)('a second review of the same head runs no command and reports the same result', async () => {
	const first = await review('r1');
	const [ran] = await checks(first, ['checker a']);
	const second = await review('r2');
	const [reused] = await checks(second, ['checker a']);

	expect(calls(first)).toBe(true);
	expect(calls(second)).toBe(false);
	expect(reused.cached).toBe(true);
	expect(reused.exitCode).toBe(ran.exitCode ?? null);
	expect(reused.output).toBe(ran.output);
});

test.skipIf(!available)('a failing result is cached like a passing one', async () => {
	const first = await review('r1');

	await checks(first, ['CHECKER_EXIT=3 checker']);

	const second = await review('r2');
	const [reused] = await checks(second, ['CHECKER_EXIT=3 checker']);

	expect(calls(second)).toBe(false);
	expect(reused.exitCode).toBe(3);
});

test.skipIf(!available)('a check with other path filters is run again', async () => {
	const first = await review('r1');

	await checks(first, ['checker src/a/']);

	const second = await review('r2');
	const [other] = await checks(second, ['checker src/b/']);

	expect(calls(second)).toBe(true);
	expect(other.cached).toBeUndefined();
});

for (const [name, file, content] of [
	['lockfile', 'bun.lock', '{"changed":true}\n'],
	['commit', 'README.md', 'change\n']
]) {
	test.skipIf(!available)(`a changed ${name} is a miss`, async () => {
		const first = await review('r1');

		await checks(first, ['checker']);

		const second = await review('r2', async (checkout) => {
			await writeFile(join(checkout, file), content);
		});

		const [other] = await checks(second, ['checker']);

		expect(calls(second)).toBe(true);
		expect(other.cached).toBeUndefined();
	});
}

test.skipIf(!available)(
	'a timed-out run is not stored',
	async () => {
		const first = await review('r1');

		const policy = REVIEW_POLICY as { baselineCheckTimeoutMs: number };
		const original = policy.baselineCheckTimeoutMs;

		policy.baselineCheckTimeoutMs = 1000;

		try {
			const [result] = await checks(first, ['sleep 30']);

			expect(result.error).toContain('timed out');
			expect(existsSync(baselineCacheDir())).toBe(false);
		} finally {
			policy.baselineCheckTimeoutMs = original;
		}
	},
	60_000
);

test.skipIf(!available)('RECODER_BASELINE_CACHE=off and the review flag both skip the cache', async () => {
	const first = await review('r1');

	await checks(first, ['checker']);

	const flagged = await review('r2');

	await checks(flagged, ['checker'], false);
	expect(calls(flagged)).toBe(true);

	process.env.RECODER_BASELINE_CACHE = 'off';

	try {
		const off = await review('r3');

		await checks(off, ['checker']);
		expect(calls(off)).toBe(true);
	} finally {
		delete process.env.RECODER_BASELINE_CACHE;
	}
});
