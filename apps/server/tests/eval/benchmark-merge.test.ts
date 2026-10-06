import { expect, test } from 'bun:test';
import { mergeReports, type MergeSource } from '../../src/eval/benchmark-merge';
import type { BenchmarkReport } from '../../src/eval/benchmark-report';
import { withHash, type RunIdentity } from '../../src/eval/identity';
import { repeatOf, shardOf, unsplitReport } from '../helpers/shards';

const named = (reports: BenchmarkReport[]): MergeSource[] =>
	reports.map((report) => ({ name: `${report.reportId}.json`, report }));

const merge = (reports: BenchmarkReport[], partial = false) => mergeReports(named(reports), { partial, allow: [] });

/** The merged report of `reports`, which must merge with no problem and hold exactly the prs of `unsplit`. */
function mergedAs(unsplit: BenchmarkReport, reports: BenchmarkReport[]) {
	const { problems, report } = merge(reports);

	expect(problems).toEqual([]);
	expect(JSON.stringify(report!.prs)).toBe(JSON.stringify(unsplit.prs));

	return report!;
}

/** The report with one identity field changed and its hash and run stamps recomputed, as a run under that change records it. */
function changedIdentity(report: BenchmarkReport, change: (identity: RunIdentity) => void): BenchmarkReport {
	const { version: _version, hash: _hash, ...fields } = structuredClone(report.identity!);

	change(fields as RunIdentity);

	const identity = withHash(fields);
	const runs = report.prs.flatMap((pr) => pr.runs);

	return {
		...report,
		identity: { ...identity, runs: { [identity.hash]: runs.length } },
		prs: report.prs.map((pr) => ({ ...pr, runs: pr.runs.map((run) => ({ ...run, identity: identity.hash })) }))
	};
}

test('shards of a report merge to its exact prs, whatever the shard count', () => {
	const unsplit = unsplitReport();

	for (const count of [1, 2, 3, 5]) {
		const shards = Array.from({ length: count }, (_, index) => shardOf(unsplit, index + 1, count));
		const report = mergedAs(unsplit, shards.reverse());

		expect(JSON.stringify(report!.summary)).toBe(
			JSON.stringify({ ...unsplit.summary, partial: false, missingTasks: [], missingRuns: [] })
		);

		expect(report!.identity!.tasks).toEqual(unsplit.identity!.tasks);
		expect(report!.identity!.hash).toBe(unsplit.identity!.hash);
		expect(report!.identity!.shard).toBeUndefined();
		expect(report!.identity!.execution.mode).toBe('full');
	}
});

test('repeats run with --repeat merge to the prs of one report with every run, agreement recomputed', () => {
	const unsplit = unsplitReport(2);

	const report = mergedAs(unsplit, [repeatOf(unsplit, 2), repeatOf(unsplit, 1)]);

	expect(report!.runsPerPr).toBe(2);
	expect(report!.identity!.execution.runsPerPr).toBe(2);
});

test('the merged report keeps each shard host and timing and says judging happened per shard', () => {
	const unsplit = unsplitReport();
	const pc = { ...shardOf(unsplit, 1, 2, 'pc'), finishedAt: '2026-10-06T01:00:00.000Z' };
	const mac = { ...shardOf(unsplit, 2, 2, 'mac'), startedAt: '2026-10-06T00:05:00.000Z' };
	const { report } = merge([pc, mac]);

	expect(report!.merge.judging).toContain('before the merge');

	expect(
		report!.merge.reports.map(({ report: name, shard, host, elapsedMs, runIds }) => ({
			name,
			shard,
			host: host.name,
			elapsedMs,
			runs: runIds.length
		}))
	).toEqual([
		{ name: 'shard-1.json', shard: { index: 1, count: 2 }, host: 'pc', elapsedMs: 3_600_000, runs: 6 },
		{ name: 'shard-2.json', shard: { index: 2, count: 2 }, host: 'mac', elapsedMs: 6_900_000, runs: 4 }
	]);

	expect([report!.startedAt, report!.finishedAt]).toEqual(['2026-10-06T00:00:00.000Z', '2026-10-06T02:00:00.000Z']);
});

test('each incompatible identity field refuses the merge and is named', () => {
	const unsplit = unsplitReport();
	const first = shardOf(unsplit, 1, 2);
	const second = shardOf(unsplit, 2, 2);

	const changes: [string, (identity: RunIdentity) => void][] = [
		['dataset.labels', (identity) => (identity.dataset.labels = 'labels-2')],
		['code.server', (identity) => (identity.code.server = 'server-2')],
		['models.orchestrator.model', (identity) => (identity.models.orchestrator.model = 'gpt-y')],
		['judge.model', (identity) => (identity.judge.model = 'judge-y')],
		['flags.RECODER_LLM_RETRIES', (identity) => (identity.flags = { RECODER_LLM_RETRIES: '3' })],
		[
			'flags.RECODER_OBLIGATIONS',
			(identity) => (identity.flags = { RECODER_LLM_RETRIES: '2', RECODER_OBLIGATIONS: 'on' })
		],
		['caches.intent', (identity) => (identity.caches.intent = 'source:def')],
		['taskSet', (identity) => (identity.taskSet = 'quick')],
		['shard.count', (identity) => (identity.shard!.count = 3)],
		['shard.all', (identity) => identity.shard!.all.pop()]
	];

	for (const [field, change] of changes) {
		const { problems, report } = merge([first, changedIdentity(second, change)]);

		expect(report).toBeNull();

		expect(problems.some((problem) => problem.startsWith(`shard-2.json differs from shard-1.json in ${field}: `))).toBe(
			true
		);
	}
});

test('a task repeat two reports hold is refused, even under different report ids', () => {
	const unsplit = unsplitReport(1);
	const again = { ...shardOf(unsplit, 2, 2), reportId: 'shard-2-again' };

	const { problems, report } = merge([shardOf(unsplit, 1, 2), shardOf(unsplit, 2, 2), again]);

	expect(report).toBeNull();

	expect(problems).toEqual([
		'task repeats held by more than one report (2): ky-3@ky-3-head#1, zod-1@zod-1-head#1; run each repeat with its own --repeat'
	]);

	const repeats = merge([repeatOf(unsplitReport(2), 1), { ...repeatOf(unsplitReport(2), 1), reportId: 'other' }]);

	expect(repeats.problems).toEqual([
		'task repeats held by more than one report (5): hono-2@hono-2-head#1, hono-10@hono-10-head#1, ky-1@ky-1-head#1, …; run each repeat with its own --repeat'
	]);
});

test('missing tasks refuse the merge unless --partial, which marks the report partial and lists them', () => {
	const unsplit = unsplitReport(2);
	const shards = [shardOf(unsplit, 1, 3), shardOf(unsplit, 3, 3)];
	const refused = merge(shards);

	expect(refused.problems).toEqual([]);
	expect(refused.report).toBeNull();
	expect(refused.missing.tasks).toEqual(shardOf(unsplit, 2, 3).identity!.shard!.tasks);

	const partial = merge(shards, true).report!;

	expect(partial.summary.partial).toBe(true);
	expect(partial.identity!.execution.mode).toBe('partial');
	expect(partial.summary.missingTasks).toEqual(refused.missing.tasks);
	expect(partial.summary.missingRuns).toEqual(refused.missing.tasks.flatMap((task) => [`${task}#1`, `${task}#2`]));
	expect(partial.prs.map((pr) => pr.taskId)).not.toContain(refused.missing.tasks[0]);
});

test('a shard stopped partway lists the runs it did not finish as missing', () => {
	const unsplit = unsplitReport(2);
	const stopped = shardOf(unsplit, 2, 2);

	stopped.prs = stopped.prs.map((pr, index) => (index ? pr : { ...pr, runs: pr.runs.slice(0, 1) }));

	const { missing, report } = merge([shardOf(unsplit, 1, 2), stopped]);

	expect(report).toBeNull();
	expect(missing).toEqual({ tasks: [], runs: [`${stopped.prs[0]!.taskId}#2`] });
});

test('a difference named with --allow-diff merges and is listed in the merged report; a name that is no field refuses', () => {
	const unsplit = unsplitReport();
	const mac = changedIdentity(shardOf(unsplit, 2, 2), (identity) => (identity.tools.node = 'v25.0.0'));
	const sources = named([shardOf(unsplit, 1, 2), mac]);

	expect(mergeReports(sources, { partial: false, allow: [] }).problems).toEqual([
		'shard-2.json differs from shard-1.json in tools.node: v24.0.0 → v25.0.0'
	]);

	const { problems, report } = mergeReports(sources, { partial: false, allow: ['tools.node'] });

	expect(problems).toEqual([]);
	expect(report!.prs.map((pr) => pr.runs.length)).toEqual(unsplit.prs.map((pr) => pr.runs.length));
	expect(report!.identity!.runs).toEqual({ [unsplit.identity!.hash]: 6, [mac.identity!.hash]: 4 });
	expect(report!.merge.declared).toEqual([{ field: 'tools.node', a: 'v24.0.0', b: 'v25.0.0', report: 'shard-2.json' }]);

	expect(mergeReports(sources, { partial: false, allow: ['tools.nod'] }).problems[0]).toBe(
		'--allow-diff tools.nod names no field of shard-1.json or shard-2.json'
	);
});
