import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BenchmarkReport } from '../../src/eval/benchmark-report';
import type { LabeledDefect } from '../../src/eval/benchmark-score';
import { selectSet, tracking } from '../../src/eval/set-selection';
import { defect, score } from '../helpers/benchmark';

const dir = mkdtempSync(join(tmpdir(), 'recoder-select-set-'));
const dataset = join(dir, 'synth');
const script = join(import.meta.dir, '../../src/eval/select-set.ts');

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const bug = (id: string, change: Partial<LabeledDefect> = {}): LabeledDefect => ({ ...defect, id, ...change });

/**
 * Two codebases: a-3 has the most disagreement, b-1 and b-2 one informative
 * defect each, a-1 the only weak-test label, a-2 the only boundary label, and
 * b-1-control the control whose published findings vary most.
 */
const labels = [
	{ id: 'a-1', codebase: 'a', defects: [bug('d1'), bug('d2', { category: 'tests' })] },
	{ id: 'a-1-control', codebase: 'a', defects: [] },
	{ id: 'a-2', codebase: 'a', defects: [bug('d1', { title: 'Off-by-one drops the last page' })] },
	{ id: 'a-3', codebase: 'a', defects: [bug('d1'), bug('d2'), bug('d3')] },
	{ id: 'b-1', codebase: 'b', defects: [bug('d1')] },
	{ id: 'b-1-control', codebase: 'b', defects: [] },
	{ id: 'b-2', codebase: 'b', defects: [bug('d1')] }
];

/** One passed run publishing `found`, with `lost` raised by a candidate and dropped, and `shown` findings. */
function run(found: string[], lost: string[] = [], shown = found.length) {
	return {
		index: 1,
		outcome: 'passed',
		findings: Array.from({ length: shown }, () => ({})),
		score: score(Object.fromEntries(found.map((id, index) => [id, index]))),
		stages: Object.fromEntries([
			...found.map((id) => [id, { found: true, verified: true, published: true }]),
			...lost.map((id) => [id, { found: true, verified: false, published: false }])
		])
	};
}

function report(finishedAt: string, runs: Record<string, ReturnType<typeof run>>): BenchmarkReport {
	return {
		dataset: 'synth',
		finishedAt,
		prs: labels.map((label) => ({
			id: label.id,
			codebase: label.codebase,
			defects: label.defects,
			runs: [runs[label.id]]
		}))
	} as unknown as BenchmarkReport;
}

const first = report('2026-10-05T10:00:00.000Z', {
	'a-1': run(['d1']),
	'a-1-control': run([], [], 2),
	'a-2': run(['d1']),
	'a-3': run(['d1', 'd2', 'd3']),
	'b-1': run(['d1']),
	'b-1-control': run([], [], 1),
	'b-2': run([])
});

const second = report('2026-10-06T10:00:00.000Z', {
	'a-1': run(['d1']),
	'a-1-control': run([], [], 2),
	'a-2': run(['d1']),
	'a-3': run([]),
	'b-1': run([]),
	'b-1-control': run([], [], 4),
	'b-2': run([], ['d1'])
});

const sources = [
	{ path: '/reports/first.json', report: first },
	{ path: '/reports/second.json', report: second }
];

test('the set holds every codebase, a weak test, a boundary and a control before filling by rank', () => {
	const { set, picks } = selectSet('synth', labels, sources, { size: 6, name: 'quick' });

	expect(set).toMatchObject({
		name: 'quick',
		tasks: ['a-1', 'a-2', 'a-3', 'b-1', 'b-1-control', 'b-2'],
		sources: ['first.json', 'second.json'],
		selectedAt: '2026-10-06T10:00:00.000Z'
	});

	expect(picks.find((pick) => pick.id === 'b-2')?.reasons).toContain('1 lost after the candidate stage');
	expect(() => selectSet('synth', labels, sources, { size: 4, name: 'quick' })).toThrow('it needs 5');
	expect(() => selectSet('other', labels, sources, { size: 6, name: 'quick' })).toThrow('Not from dataset other');
});

test('a subset is scored over its own planted defects, next to the full report', () => {
	expect(tracking(first, ['a-3', 'b-1-control'])).toEqual({
		subset: { planted: 3, found: 3 },
		full: { planted: 8, found: 6 }
	});
});

test('identical reports write a byte-equal set file, whatever order they are passed in', () => {
	mkdirSync(join(dataset, 'labels'), { recursive: true });

	for (const label of labels) writeFileSync(join(dataset, 'labels', `${label.id}.json`), JSON.stringify(label));

	const paths = sources.map(({ path, report }) => {
		const file = join(dir, path.split('/').at(-1)!);

		writeFileSync(file, JSON.stringify(report));

		return file;
	});

	const select = (reports: string[]) => {
		const result = Bun.spawnSync(
			[process.execPath, script, '--dataset', dataset, '--reports', reports.join(','), '--size', '6', '--out', 'quick'],
			{ stdout: 'pipe', stderr: 'pipe' }
		);

		expect(result.exitCode).toBe(0);

		return readFileSync(join(dataset, 'sets', 'quick.json'));
	};

	const once = select(paths);

	expect(select([...paths].reverse()).equals(once)).toBe(true);
	expect(JSON.parse(once.toString()).tasks).toContain('b-1-control');
});
