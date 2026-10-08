import type { PipelineRun, StoredMetrics } from '../models/metrics';
import type { BenchmarkReport, ScoredRun } from './benchmark-report';
import { NOT_RECORDED, type ReviewerMix } from './identity';

/** The calls of one pipeline run; `run` is null for calls stored before runs were recorded. */
export interface SegmentAudit {
	run: number | null;
	/** The run's locked models, null when not recorded. */
	picks: string[] | null;
	calls: Record<string, number>;
}

/**
 * Which models one review ran on, judged from its stored metrics. A review is MIXED when a pipeline call used a
 * model outside its run's locked picks or the report's reviewer, when its pipeline runs locked different picks, or
 * when a call went without locked models; MISSING when the store has no row for it.
 */
export interface ReviewVerdict {
	status: 'CLEAN' | 'MIXED' | 'MISSING';
	segments: SegmentAudit[];
	/** Pipeline runs the review's metrics hold; more than one means its calls come from several runs. */
	runs: number;
	/** Models resolved from the live settings inside a pipeline run. */
	lockMisses: number;
	/** Pipeline calls made without locked models. */
	unlockedCalls: number;
	/** Why the review is MIXED. */
	reasons: string[];
}

/** A pick a pipeline run locked. The store records no effort, so it is `not recorded`. */
interface LockedPick {
	model: string;
	effort: typeof NOT_RECORDED;
}

/** A benchmark run's reviewer, read from its review's stored metrics after the review finished. */
export interface RunReviewer {
	/** The picks the review's last pipeline run locked; `not recorded` when the row predates runs or the run went unlocked. */
	orchestrator: LockedPick | typeof NOT_RECORDED;
	specialist: LockedPick | typeof NOT_RECORDED;
	pipelineRuns: number;
	lockMisses: number;
	unlockedCalls: number;
	/** The distinct models the review's pipeline calls used. */
	calledModels: string[];
	/** The reviewer audit's verdict on the review. */
	verdict: ReviewVerdict['status'];
	/** The audit's verdict MIXED, or locked picks other than the report declares. */
	mixed: boolean;
	/** Why the run is mixed. */
	reasons: string[];
}

/** The models the report says reviewed: its identity's stage models, else its reviewer manifest. */
export function reportedModels(report: Pick<BenchmarkReport, 'identity' | 'reviewer'>): string[] | null {
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

export function segmentName(segment: SegmentAudit): string {
	return segment.run === null ? 'runs not recorded' : `run ${segment.run}`;
}

/** The verdict on one review from its stored metrics, null when the store has no row, against the `reported` models. */
export function classifyReview(stored: StoredMetrics | null, reported: string[] | null): ReviewVerdict {
	if (!stored) return { status: 'MISSING', segments: [], runs: 0, lockMisses: 0, unlockedCalls: 0, reasons: [] };

	const segments = segmentsOf(stored);
	const reasons = mixedReasons(stored, segments, reported);

	return {
		status: reasons.length ? 'MIXED' : 'CLEAN',
		segments,
		runs: stored.runs?.length ?? 0,
		...missesOf(stored),
		reasons
	};
}

function lockedPick(model: string | undefined): LockedPick | typeof NOT_RECORDED {
	return model ? { model, effort: NOT_RECORDED } : NOT_RECORDED;
}

/** "locked a/b, the report declares c/d" when a locked pick is another model than `declared` names for its stage. */
function picksReason(reviewer: Pick<RunReviewer, 'orchestrator' | 'specialist'>, declared: string[] | null): string[] {
	const picks = [reviewer.orchestrator, reviewer.specialist];

	if (!declared || picks.every((pick, stage) => pick === NOT_RECORDED || pick.model === declared[stage])) return [];

	const named = picks.map((pick) => (pick === NOT_RECORDED ? NOT_RECORDED : pick.model));

	return [`locked ${named.join('/')}, the report declares ${declared.join('/')}`];
}

/**
 * A run's reviewer from its review's stored metrics, null when the store has no row, against the models the
 * report `declared` (orchestrator, then specialist).
 */
export function runReviewer(stored: StoredMetrics | null, declared: string[] | null): RunReviewer {
	const verdict = classifyReview(stored, declared);
	const last = stored?.runs?.at(-1);
	const picks = picksOf(last);
	const locked = { orchestrator: lockedPick(picks?.[0]), specialist: lockedPick(picks?.[1]) };
	const differs = picksReason(locked, declared);

	return {
		...locked,
		pipelineRuns: verdict.runs,
		lockMisses: verdict.lockMisses,
		unlockedCalls: verdict.unlockedCalls,
		calledModels: [...new Set(verdict.segments.flatMap((segment) => Object.keys(segment.calls)))].sort(),
		verdict: verdict.status,
		mixed: verdict.status === 'MIXED' || differs.length > 0,
		reasons: [...verdict.reasons, ...differs]
	};
}

/** True when some run's reviewer is mixed, false when every recorded one is clean, `not recorded` when none is. */
export function mixedReviewer(runs: readonly ScoredRun[]): ReviewerMix {
	const recorded = runs.flatMap((run) => (run.reviewer ? [run.reviewer] : []));

	return recorded.length ? recorded.some((reviewer) => reviewer.mixed) : NOT_RECORDED;
}

/**
 * A merged report's `mixedReviewer`: true when any source's is, false when one is and none is true, `not recorded`
 * when every source says so, and absent when no source records it.
 */
export function mergedMixedReviewer(sources: readonly (ReviewerMix | undefined)[]): { mixedReviewer?: ReviewerMix } {
	if (sources.includes(true)) return { mixedReviewer: true };
	if (sources.includes(false)) return { mixedReviewer: false };

	return sources.includes(NOT_RECORDED) ? { mixedReviewer: NOT_RECORDED } : {};
}

/** The printout's closing "reviewer: clean" or "reviewer: MIXED (2 runs)"; nothing for a report older than recording reviewers. */
export function reviewerSummaryLines(report: BenchmarkReport): string[] {
	const mixed = report.summary.mixedReviewer;

	if (mixed === undefined) return [];

	const runs = report.prs.flatMap((pr) => pr.runs);
	const count = runs.filter((run) => run.reviewer?.mixed).length;
	const missing = runs.filter((run) => run.reviewer?.verdict === 'MISSING').length;
	const verdict = mixed === NOT_RECORDED ? NOT_RECORDED : mixed ? `MIXED (${count} runs)` : 'clean';

	return ['', `reviewer: ${verdict}${missing ? `, ${missing} runs missing from the store` : ''}`];
}
