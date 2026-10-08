import type { BenchmarkReport, ConfigKey, JudgeModel, ReviewerManifest, ScoredRun, Totals } from './types';

/** Found over planted, or null when nothing was planted. */
export function recall(totals: Totals | undefined): number | null {
	return totals && totals.planted ? totals.found / totals.planted : null;
}

/** A share as a whole percent, or an en dash when there is none. */
export function percent(share: number | null | undefined): string {
	return share === null || share === undefined || Number.isNaN(share) ? '–' : `${Math.round(share * 100)}%`;
}

/** `opencode:openai/gpt-6-luna` or `openai/gpt-6-luna` → `gpt-6-luna`. */
export function shortModel(model: string | null | undefined): string {
	if (!model) return 'unknown';

	return model.split(':').at(-1)!.split('/').at(-1)!;
}

function withEffort(model: string, effort: string | null | undefined): string {
	return effort ? `${shortModel(model)} ${effort}` : shortModel(model);
}

/**
 * The reviewer and judge behind a report's scores. The specialist model is
 * part of the reviewer when it differs, since it runs the verifiers.
 */
export function configKey(reviewer: ReviewerManifest | null | undefined, judge: JudgeModel): ConfigKey {
	const second =
		reviewer?.specialistModel && shortModel(reviewer.specialistModel) !== shortModel(reviewer.model)
			? ` + ${withEffort(reviewer.specialistModel, reviewer.specialistEffort)}`
			: '';

	const review = reviewer ? withEffort(reviewer.model, reviewer.effort) + second : 'unknown reviewer';
	const judged = withEffort(judge.model, judge.effort);

	return { id: `${review}|${judged}`, reviewer: review, judge: judged };
}

/** The share of shown findings that report a planted defect: a lower bound on precision. */
export function labeledPrecision(findings: number, unlabeled: number): number | null {
	return findings ? (findings - unlabeled) / findings : null;
}

/** Every run in a report, flattened with its PR id. */
export function allRuns(report: BenchmarkReport): (ScoredRun & { pr: string })[] {
	return report.prs.flatMap((pr) => pr.runs.map((run) => ({ ...run, pr: pr.id })));
}

/** Minutes, rounded to one decimal under ten. */
export function minutes(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return '–';

	const value = ms / 60_000;

	return value < 10 ? `${value.toFixed(1)}m` : `${Math.round(value)}m`;
}

/** A date as `Oct 7, 16:09` in the viewer's zone. */
export function shortDate(iso: string): string {
	return new Date(iso).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
}
