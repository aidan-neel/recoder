import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityLine, readReport } from '../../src/eval/benchmark-report';
import { withHash } from '../../src/eval/identity';
import { identityFields, writeReport } from '../helpers/identity';

const dir = mkdtempSync(join(tmpdir(), 'recoder-report-'));

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

test('a report older than identities is still read, and says it records none', () => {
	const report = readReport(writeReport(dir, 'old.json'));

	expect(report.prs[0]!.runs).toHaveLength(1);
	expect(report.identity).toBeUndefined();
	expect(identityLine(report)).toBe('Identity not recorded');
});

test('a report with an identity names its hash, tasks and runs', () => {
	const identity = withHash(identityFields());
	const report = readReport(writeReport(dir, 'new.json', { identity, runIds: ['pr-1@aaa#1'] }));

	expect(identityLine(report)).toBe(`Identity ${identity.hash.slice(0, 12)} · 1 tasks · 1 runs`);
});
