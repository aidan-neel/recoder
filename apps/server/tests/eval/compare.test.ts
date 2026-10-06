import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withHash } from '../../src/eval/identity';
import { identityFields, writeReport } from '../helpers/identity';

const dir = mkdtempSync(join(tmpdir(), 'recoder-compare-'));
const script = join(import.meta.dir, '../../src/eval/compare.ts');

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function compare(...args: string[]): { code: number; out: string } {
	const result = Bun.spawnSync([process.execPath, script, ...args], { stdout: 'pipe', stderr: 'pipe' });

	return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

const off = withHash(identityFields());

const on = withHash({
	...identityFields(),
	flags: { RECODER_TEST_STRENGTH: '1', RECODER_OBLIGATIONS: 'unset' }
});

test('two reports of one experiment compare, with stage counts side by side and their repeated runs refusing a merge', () => {
	const a = writeReport(dir, 'a.json', { identity: off, runIds: ['pr-1@aaa#1'] });
	const b = writeReport(dir, 'b.json', { identity: off, runIds: ['pr-1@aaa#1'] });
	const { code, out } = compare(a, b);

	expect(code).toBe(0);
	expect(out).toContain('Compatible: every checked field matches');
	expect(out).toContain('Merge: refused, run ids listed more than once (1): pr-1@aaa#1');
	expect(out).toMatch(/hono\s+1\/1\/0 of 1\s+1\/1\/0 of 1/);
});

test('an undeclared flag difference fails with the field named; declared, the counts are compared', () => {
	const a = writeReport(dir, 'off.json', { identity: off, runIds: ['pr-1@aaa#1'] });
	const b = writeReport(dir, 'on.json', { identity: on, runIds: ['pr-1@aaa#2'] });
	const refused = compare(a, b);

	expect(refused.code).toBe(1);
	expect(refused.out).toContain('Incompatible:\n  flags.RECODER_TEST_STRENGTH: unset → 1');
	expect(refused.out).not.toContain('Planted defects by codebase');

	const declared = compare(a, b, '--allow-diff', 'flags.RECODER_TEST_STRENGTH');

	expect(declared.code).toBe(0);
	expect(declared.out).toContain('Declared differences:\n  flags.RECODER_TEST_STRENGTH: unset → 1');
	expect(declared.out).toContain('Planted defects by codebase');
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
