import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
	adjudicationPath,
	findingKey,
	labelRun,
	precisionBounds,
	queueUnresolved,
	readAdjudications,
	summarizeLabels,
	type Adjudications
} from '../../src/eval/benchmark-labels';
import type { EvalFinding } from '../../src/eval/metrics';
import { score } from '../helpers/benchmark';

function finding(fingerprint: string, method?: 'run' | 'trace' | 'rule'): EvalFinding {
	return {
		fingerprint,
		file: 'src/a.ts',
		line: 3,
		message: 'm',
		severity: 'warning',
		verification: method ? { status: 'verified', reason: '', method } : undefined
	};
}

const adjudicated = (label: 'additional' | 'false'): Adjudications => ({
	'ky-1:fp-b': { label, file: 'src/a.ts', line: 3, title: '', note: '' }
});

test('a human label applies to every run that has the finding, and the judge keeps planted and duplicate', () => {
	const findings = [finding('fp-a'), finding('fp-b'), finding('fp-c'), finding('fp-d')];
	const judged = { ...score({ d1: 0 }), duplicates: [3], unlabeled: [1, 2] };

	const labeled = labelRun('ky-1', { findings, score: judged }, adjudicated('additional'));

	expect(labeled.classes).toEqual(['planted', 'additional', 'unresolved', 'duplicate']);
});

test('labeling a finding once changes the summary of a run scored before the label existed', () => {
	const findings = [finding('fp-b')];
	const run = { findings, score: { ...score({}), unlabeled: [0] } };
	const before = summarizeLabels([{ codebase: 'ky', control: false, runs: [labelRun('ky-1', run, {})] }]);

	const after = summarizeLabels([
		{ codebase: 'ky', control: false, runs: [labelRun('ky-1', run, adjudicated('false'))] }
	]);

	expect([before.overall.counts.unresolved, before.overall.counts.false]).toEqual([1, 0]);
	expect([after.overall.counts.unresolved, after.overall.counts.false]).toEqual([0, 1]);
});

test('precision is an interval that counts unresolved findings wrong at the bottom and right at the top', () => {
	const bounds = precisionBounds({ planted: 4, additional: 1, false: 3, unresolved: 2, duplicate: 9 });

	expect(bounds).toEqual({ lower: 0.5, upper: 0.7, unresolved: 2 });
	expect(precisionBounds({ planted: 0, additional: 0, false: 0, unresolved: 0, duplicate: 2 })).toBeNull();
});

test('findings are queued once as unresolved with enough context to decide them', () => {
	const findings = [finding('fp-a'), finding('fp-b')];
	const adjudications = adjudicated('false');
	const labeled = labelRun('ky-1', { findings, score: { ...score({}), unlabeled: [0, 1] } }, adjudications);

	expect(queueUnresolved(adjudications, findings, labeled)).toBe(true);
	expect(adjudications['ky-1:fp-a']).toMatchObject({ label: 'unresolved', file: 'src/a.ts', line: 3 });
	expect(adjudications['ky-1:fp-b']!.label).toBe('false');
	expect(queueUnresolved(adjudications, findings, labeled)).toBe(false);
});

test('a control PR run is wrong when a comment is false, and possibly wrong when one is unresolved', () => {
	const run = (labels: Adjudications, findings: EvalFinding[]) =>
		labelRun('c-1', { findings, score: { ...score({}), unlabeled: findings.map((_, index) => index) } }, labels);

	const adjudications: Adjudications = { 'c-1:fp-a': { label: 'false', file: 'f', line: null, title: '', note: '' } };

	const { control } = summarizeLabels([
		{
			codebase: 'ky',
			control: true,
			runs: [run(adjudications, [finding('fp-a')]), run({}, [finding('fp-z')]), run({}, [])]
		}
	]);

	expect(control).toEqual({ prs: 1, runs: 3, wrong: 1, possiblyWrong: 2 });
});

test('evidence groups split findings by how they were verified', () => {
	const findings = [finding('a', 'run'), finding('b', 'trace'), finding('c', 'rule'), finding('d')];

	const labeled = labelRun('ky-1', { findings, score: { ...score({}), unlabeled: [0, 1, 2, 3] } }, {});

	expect(labeled.evidence).toEqual(['runtime', 'static', 'policy', 'unproven']);
});

test('a hidden additional true positive counts only when no shown finding repeats it', () => {
	const shown = [finding('fp-a')];
	const hidden = [finding('fp-a'), finding('fp-b')];

	const labels: Adjudications = {
		'ky-1:fp-a': { label: 'additional', file: 'f', line: null, title: '', note: '' },
		'ky-1:fp-b': { label: 'additional', file: 'f', line: null, title: '', note: '' }
	};

	const run = labelRun(
		'ky-1',
		{
			findings: shown,
			score: { ...score({}), unlabeled: [0] },
			unconfirmed: hidden,
			hiddenScore: { ...score({}), unlabeled: [0, 1] }
		},
		labels
	);

	expect(summarizeLabels([{ codebase: 'ky', control: false, runs: [run] }]).hiddenAdditional).toBe(1);
});

test('a finding without a fingerprint is keyed by its place', () => {
	expect(findingKey('ky-1', { ...finding('x'), fingerprint: undefined, category: 'logic' })).toBe(
		'ky-1:src/a.ts:3:logic'
	);
});

test('a malformed adjudication file is an error, not an empty set', () => {
	const dir = mkdtempSync(join(tmpdir(), 'adjudications-'));

	expect(readAdjudications(adjudicationPath(dir))).toEqual({});

	writeFileSync(adjudicationPath(dir), JSON.stringify({ 'ky-1:x': { label: 'maybe', file: 'f' } }));

	expect(() => readAdjudications(adjudicationPath(dir))).toThrow();
});
