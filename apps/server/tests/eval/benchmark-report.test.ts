import { afterAll, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityLine, printBenchmark, readReport } from '../../src/eval/benchmark-report';
import { summarize } from '../../src/eval/benchmark-score';
import { writeReport } from '../helpers/identity';

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

test('a subset report says in its header that it is no full-set score; a full one does not', () => {
	const report = readReport(writeReport(dir, 'subset.json'));
	const log = spyOn(console, 'log').mockImplementation(() => {});

	const header = (taskSet: string) => {
		printBenchmark({ ...report, summary: { ...summarize([]), taskSet } });

		return String(log.mock.calls.at(-1)?.[0]).split('\n').slice(1, 3);
	};

	try {
		expect(header('quick')).toEqual([
			'Benchmark synth, set quick: 1 PRs × 1 runs',
			'Task set quick: subset result, not a full-set score.'
		]);

		expect(header('full')[1]).toStartWith('Judge ');
	} finally {
		log.mockRestore();
	}
});
