/**
 * Which models a benchmark's reviews ran on, read from the server's stored call metrics.
 *
 *   bun src/eval/reviewer-audit.ts <report.json> <recoder.db>
 *
 * Opens the store read-only. Per run it prints the review's pipeline calls by model, split by the pipeline run that
 * made them (a replay, reverify, continue or rerun runs the pipeline again on the same review), its lock misses, and
 * CLEAN, MIXED or MISSING. A run is MIXED when a pipeline call used a model outside its run's locked picks or the
 * report's reviewer, when its pipeline runs locked different picks, or when a call went without locked models.
 * Calls stored before runs were recorded are judged against the report's reviewer only, by the model name the call
 * stored. Exits 1 when any run is MIXED.
 */
import { Database } from 'bun:sqlite';
import type { PipelineRun, RunTokenCall } from '../models/metrics';
import { readReport, type BenchmarkReport } from './benchmark-report';

/** A review's stored metrics as the audit reads them; rows older than run segments have no `runs`. */
interface StoredMetrics {
	runs?: PipelineRun[];
	calls: RunTokenCall[];
}

/** The calls of one pipeline run; `run` is null for calls stored before runs were recorded. */
interface SegmentAudit {
	run: number | null;
	/** The run's locked models, null when not recorded. */
	picks: string[] | null;
	calls: Record<string, number>;
}

export interface RunAudit {
	task: string;
	index: number;
	reviewId: string;
	status: 'CLEAN' | 'MIXED' | 'MISSING';
	segments: SegmentAudit[];
	/** Pipeline runs the review's metrics hold; more than one means its calls come from several runs. */
	runs: number;
	/** Models resolved from the live settings inside a pipeline run. */
	lockMisses: number;
	/** Pipeline calls made without locked models. */
	unlockedCalls: number;
	/** Why the run is MIXED. */
	reasons: string[];
}

/** The models the report says reviewed: its identity's stage models, else its reviewer manifest. */
function reportedModels(report: BenchmarkReport): string[] | null {
	const identity = report.identity?.models;

	if (identity) return [identity.orchestrator.model, identity.specialist.model];
	if (report.reviewer) return [report.reviewer.model, report.reviewer.specialistModel ?? report.reviewer.model];

	return null;
}

/** A run's locked picks, null when it ran unlocked or the row predates runs. */
function picksOf(run: PipelineRun | undefined): string[] | null {
	return run?.orchestrator && run.subagent ? [run.orchestrator, run.subagent] : null;
}

/** The review's pipeline calls by the run that made them, oldest run first. */
function segmentsOf(stored: StoredMetrics): SegmentAudit[] {
	const segments = new Map<number | null, SegmentAudit>();

	for (const run of stored.runs ?? []) segments.set(run.index, { run: run.index, picks: picksOf(run), calls: {} });

	for (const call of stored.calls.filter((item) => item.scope === 'pipeline')) {
		const run = call.run ?? null;
		const segment = segments.get(run) ?? { run, picks: null, calls: {} };

		segment.calls[call.model] = (segment.calls[call.model] ?? 0) + 1;
		segments.set(run, segment);
	}

	return [...segments.values()].sort((a, b) => (a.run ?? -1) - (b.run ?? -1));
}

/** Why a review's stored calls do not all come from the reviewer the report names. */
function mixedReasons(stored: StoredMetrics, segments: SegmentAudit[], reported: string[] | null): string[] {
	const reasons: string[] = [];
	const picks = new Set(segments.flatMap((segment) => (segment.picks ? [segment.picks.join('/')] : [])));

	if (picks.size > 1) reasons.push(`runs locked different models: ${[...picks].join(', ')}`);

	for (const segment of segments) {
		const allowed = [segment.picks, reported].filter((models): models is string[] => models !== null);
		const foreign = Object.keys(segment.calls).filter((model) => allowed.some((models) => !models.includes(model)));

		if (foreign.length) reasons.push(`${segmentName(segment)} called ${foreign.join(', ')}`);
	}

	const { lockMisses, unlockedCalls } = missesOf(stored);

	if (lockMisses || unlockedCalls) reasons.push(`${lockMisses} lock misses, ${unlockedCalls} unlocked calls`);

	return reasons;
}

/** Models the review's pipeline runs resolved from the live settings, and calls they made without locked models. */
function missesOf(stored: StoredMetrics): { lockMisses: number; unlockedCalls: number } {
	return {
		lockMisses: (stored.runs ?? []).reduce((total, run) => total + run.lockMisses, 0),
		unlockedCalls: stored.calls.filter((call) => call.lockMiss).length
	};
}

function segmentName(segment: SegmentAudit): string {
	return segment.run === null ? 'runs not recorded' : `run ${segment.run}`;
}

/** Audits every run of `report` against the metrics `store` holds for its review. */
export function auditReport(report: BenchmarkReport, store: Database): RunAudit[] {
	const query = store.query<{ value: string }, [string]>('SELECT value FROM review_metrics WHERE id = ?');
	const reported = reportedModels(report);

	return report.prs.flatMap((pr) =>
		pr.runs.map((run): RunAudit => {
			const base = { task: pr.id, index: run.index, reviewId: run.reviewId };
			const row = query.get(run.reviewId);

			if (!row)
				return { ...base, status: 'MISSING', segments: [], runs: 0, lockMisses: 0, unlockedCalls: 0, reasons: [] };

			const stored = JSON.parse(row.value) as StoredMetrics;
			const segments = segmentsOf(stored);
			const reasons = mixedReasons(stored, segments, reported);

			return {
				...base,
				status: reasons.length ? 'MIXED' : 'CLEAN',
				segments,
				runs: stored.runs?.length ?? 0,
				...missesOf(stored),
				reasons
			};
		})
	);
}

function segmentLine(segment: SegmentAudit): string {
	const calls = Object.entries(segment.calls)
		.map(([model, count]) => `${model}×${count}`)
		.join(' ');

	return `${segmentName(segment)}${segment.picks ? ` [${segment.picks.join('/')}]` : ''}: ${calls || 'no calls'}`;
}

/** The audit as printed: a header, one line per run with its segments, and a summary. */
export function auditLines(report: BenchmarkReport, audits: RunAudit[]): string[] {
	const reported = reportedModels(report);
	const count = (status: RunAudit['status']) => audits.filter((audit) => audit.status === status).length;
	const reruns = audits.filter((audit) => audit.runs > 1).length;

	return [
		`Reviewer audit: ${report.dataset}, report reviewer ${reported ? reported.join('/') : 'not recorded'}`,
		...audits.flatMap((audit) => [
			`  ${audit.task} #${audit.index} ${audit.reviewId} ${audit.status}  pipeline runs ${audit.runs}  lock misses ${audit.lockMisses}  unlocked calls ${audit.unlockedCalls}`,
			...audit.segments.map((segment) => `    ${segmentLine(segment)}`),
			...audit.reasons.map((reason) => `    MIXED: ${reason}`)
		]),
		`Summary: ${audits.length} runs, ${count('CLEAN')} clean, ${count('MIXED')} mixed, ${count('MISSING')} missing from the store, ${reruns} with more than one pipeline run`
	];
}

/** Runs the audit for `args` (report path, store path) and returns the exit code. */
function main(args: string[]): number {
	const [reportPath, storePath] = args;

	if (!reportPath || !storePath) {
		console.error('Usage: bun src/eval/reviewer-audit.ts <report.json> <recoder.db>');

		return 2;
	}

	const report = readReport(reportPath);
	const store = new Database(storePath, { readonly: true });

	try {
		const audits = auditReport(report, store);

		console.log(auditLines(report, audits).join('\n'));

		return audits.some((audit) => audit.status === 'MIXED') ? 1 : 0;
	} finally {
		store.close();
	}
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
