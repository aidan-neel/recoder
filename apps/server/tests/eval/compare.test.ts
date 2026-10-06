import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityFields, recordedIdentity, writeReport } from '../helpers/identity';

const dir = mkdtempSync(join(tmpdir(), 'recoder-compare-'));
const script = join(import.meta.dir, '../../src/eval/compare.ts');

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function compare(...args: string[]): { code: number; out: string } {
	const result = Bun.spawnSync([process.execPath, script, ...args], { stdout: 'pipe', stderr: 'pipe' });

	return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

const off = recordedIdentity(identityFields());

const on = recordedIdentity({
	...identityFields(),
	flags: { RECODER_LLM_RETRIES: '2', RECODER_TEST_STRENGTH: '1' }
});

test('two repeats of one experiment compare and merge, with report ids and stage counts side by side', () => {
	const a = writeReport(dir, 'a.json', { identity: off, runIds: ['pr-1@aaa#1'], reportId: 'report-a' });
	const b = writeReport(dir, 'b.json', { identity: off, runIds: ['pr-1@aaa#1'], reportId: 'report-b' });
	const { code, out } = compare(a, b);

	expect(code).toBe(0);
	expect(out).toContain('A  a.json · report report-a · 1 PRs × 1 runs');
	expect(out).toContain('B  b.json · report report-b · 1 PRs × 1 runs');
	expect(out).toContain('Compatible: every checked field matches');
	expect(out).toContain('Merge: possible');
	expect(out).toMatch(/hono\s+1\/1\/0 of 1\s+1\/1\/0 of 1/);

	const replay = writeReport(dir, 'a-replay.json', { identity: off, runIds: ['pr-1@aaa#1'], reportId: 'report-a' });

	expect(compare(a, replay).out).toContain('Merge: refused, run ids listed more than once (1): pr-1@aaa#1');
});

test('an undeclared flag difference fails with the field named; declared, the counts are compared', () => {
	const a = writeReport(dir, 'off.json', { identity: off, runIds: ['pr-1@aaa#1'] });
	const b = writeReport(dir, 'on.json', { identity: on, runIds: ['pr-1@aaa#2'] });
	const refused = compare(a, b);

	expect(refused.code).toBe(1);
	expect(refused.out).toContain('Incompatible:\n  flags.RECODER_TEST_STRENGTH: (absent) → 1');
	expect(refused.out).not.toContain('Planted defects by codebase');

	const declared = compare(a, b, '--allow-diff', 'flags.RECODER_TEST_STRENGTH');

	expect(declared.code).toBe(0);
	expect(declared.out).toContain('Declared differences:\n  flags.RECODER_TEST_STRENGTH: (absent) → 1');
	expect(declared.out).toContain('Planted defects by codebase');

	const typo = compare(a, b, '--allow-diff', 'flags.RECODER_TEST_STRENGHT');

	expect(typo.code).toBe(1);
	expect(typo.out).toContain('--allow-diff flags.RECODER_TEST_STRENGHT is no field of either identity; valid: flags.');
	expect(typo.out).not.toContain('Planted defects by codebase');
});

test('two reports that could not read the server are refused: unknown flags are unverifiable, not a match', () => {
	const blind = recordedIdentity({ ...identityFields(), flags: 'unknown' });
	const a = writeReport(dir, 'blind-a.json', { identity: blind, runIds: ['pr-1@aaa#1'] });
	const b = writeReport(dir, 'blind-b.json', { identity: blind, runIds: ['pr-1@aaa#2'] });
	const { code, out } = compare(a, b);

	expect(code).toBe(1);
	expect(out).toContain('Unverifiable:\n  flags: unknown → unknown');
	expect(out).not.toContain('Compatible:');
	expect(out).toContain('Merge: refused, B cannot be checked against A in flags: unknown → unknown');
});

test('a report holding runs reviewed under no recorded identity is refused, with the counts named', () => {
	const mixed = { ...off, runs: { [off.hash]: 1, 'not recorded': 2 } };
	const a = writeReport(dir, 'mixed.json', { identity: mixed, runIds: ['pr-1@aaa#1', 'pr-1@aaa#2', 'pr-1@aaa#3'] });
	const b = writeReport(dir, 'clean.json', { identity: off, runIds: ['pr-1@aaa#4'] });
	const short = off.hash.slice(0, 12);
	const { code, out } = compare(a, b);

	expect(code).toBe(1);
	expect(out).toContain(`3 runs (mixed: 1 under ${short}, 2 not recorded)`);
	expect(out).toContain(`Unverifiable:\n  runs: 1 under ${short}, 2 not recorded → 1 under ${short}`);
	expect(compare(a, b, '--allow-diff', 'runs').code).toBe(0);
});

test('a report without an identity is compared with a warning, and refuses a merge', () => {
	const { code, out } = compare(
		writeReport(dir, 'old.json'),
		writeReport(dir, 'new.json', { identity: off, runIds: [] })
	);

	expect(code).toBe(0);
	expect(out).toContain('Identity not recorded in A; no equivalence can be claimed.');
	expect(out).toContain('Merge: refused, identity not recorded in A');
	expect(out).toContain('Warning: identity not recorded');
});

test('reports from different task sets are refused unless the difference is declared', () => {
	const quick = recordedIdentity({ ...identityFields(), taskSet: 'quick' });
	const a = writeReport(dir, 'set-quick.json', { identity: quick, runIds: ['pr-1@aaa#1'] });
	const b = writeReport(dir, 'set-full.json', { identity: off, runIds: ['pr-1@aaa#2'] });
	const refused = compare(a, b);

	expect(refused.code).toBe(1);
	expect(refused.out).toContain('Incompatible:\n  taskSet: quick → full');
	expect(compare(a, b, '--allow-diff', 'taskSet').code).toBe(0);
});
