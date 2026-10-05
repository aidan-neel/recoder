import { sumLows, type LowTotals } from './benchmark-lows';
import { stageTotals, type DefectStage, type StageTotals } from './benchmark-stages';

/** A planted defect, as the dataset's label file describes it. */
export interface LabeledDefect {
	id: string;
	kind: 'bug' | 'quality';
	category: string;
	file: string;
	line: number;
	endLine?: number | null;
	title: string;
	description: string;
	fix: string;
}

/** How a review's findings line up with one PR's planted defects. */
export interface PrScore {
	/** Defect id → the index of the finding that found it. */
	found: Record<string, number>;
	/** Defect id → the judge's one-sentence reason for its call. */
	reasons: Record<string, string>;
	missed: string[];
	/** Findings that restate a defect another finding already found. */
	duplicates: number[];
	/** Findings that report no planted defect: false positives, or real issues the generator didn't plant. */
	unlabeled: number[];
}

/** Defects found over planted, and findings that matched over findings that hit something, summed across runs. */
export interface Totals {
	planted: number;
	found: number;
	/** Findings that report no planted defect. */
	unlabeled: number;
}

/** What reviews hid, judged against the same planted defects. */
interface HiddenTotals {
	/** Hidden candidates judged. */
	candidates: number;
	/** Hidden candidates that report a planted defect. */
	matched: number;
	/** Planted defects only a hidden candidate reported: true positives verification threw away. */
	lost: number;
}

/** A passed run's findings score next to its hidden candidates' score. */
interface HiddenRun {
	shown: PrScore;
	hidden: PrScore;
}

/** One PR's labels and the score of each of its passed runs. */
export interface PrRuns {
	codebase: string;
	defects: readonly LabeledDefect[];
	scores: readonly PrScore[];
	/** The passed runs whose hidden candidates were judged. */
	hiddenRuns?: readonly HiddenRun[];
	/** How far each defect got in the passed runs whose candidates were read. */
	stageRuns?: readonly Record<string, DefectStage>[];
	/** Published below-bar findings of the passed runs whose candidates were read. */
	lowRuns?: readonly LowTotals[];
}

export interface BenchmarkSummary {
	overall: Totals;
	byCodebase: Record<string, Totals>;
	byKind: Record<string, Totals>;
	byCategory: Record<string, Totals>;
	/** Of the defects found in at least one run, the share found in every run; null with fewer than two runs a PR. */
	defectStability: number | null;
	hidden: HiddenTotals;
	/** Recall by stage; absent from reports older than reading candidates, and when no run's candidates were read. */
	stages?: StageTotals;
	/** Published below-bar findings by reason, over the runs whose candidates were read; absent when none were. */
	lows?: LowTotals;
}

function totalsIn(groups: Record<string, Totals>, key: string): Totals {
	groups[key] ??= { planted: 0, found: 0, unlabeled: 0 };

	return groups[key];
}

/** Count a defect, and whether it was found, toward a group. */
function tallyDefect(totals: Totals, found: boolean): void {
	totals.planted++;
	if (found) totals.found++;
}

/**
 * Sums every passed run of every PR. Kind and category groups only count
 * recall: an unlabeled finding belongs to no planted defect's group.
 */
export function summarize(prs: readonly PrRuns[]): BenchmarkSummary {
	const overall: Totals = { planted: 0, found: 0, unlabeled: 0 };
	const byCodebase: Record<string, Totals> = {};
	const byKind: Record<string, Totals> = {};
	const byCategory: Record<string, Totals> = {};
	let foundOnce = 0;
	let foundEvery = 0;

	for (const pr of prs) {
		const hits = new Map<string, number>();

		for (const score of pr.scores) {
			for (const defect of pr.defects) {
				const found = defect.id in score.found;

				if (found) hits.set(defect.id, (hits.get(defect.id) ?? 0) + 1);

				for (const totals of [overall, totalsIn(byCodebase, pr.codebase)]) tallyDefect(totals, found);
				tallyDefect(totalsIn(byKind, defect.kind), found);
				tallyDefect(totalsIn(byCategory, defect.category), found);
			}

			overall.unlabeled += score.unlabeled.length;
			totalsIn(byCodebase, pr.codebase).unlabeled += score.unlabeled.length;
		}

		if (pr.scores.length < 2) continue;

		foundOnce += hits.size;
		foundEvery += [...hits.values()].filter((count) => count === pr.scores.length).length;
	}

	const multiRun = prs.some((pr) => pr.scores.length > 1);
	const hidden = hiddenTotals(prs.flatMap((pr) => pr.hiddenRuns ?? []));
	const lowRuns = prs.flatMap((pr) => pr.lowRuns ?? []);
	const staged = prs.flatMap((pr) => (pr.stageRuns ?? []).map((stages) => ({ defects: pr.defects, stages })));

	return {
		overall,
		byCodebase,
		byKind,
		byCategory,
		defectStability: multiRun && foundOnce ? foundEvery / foundOnce : null,
		hidden,
		...(staged.length ? { stages: stageTotals(staged) } : {}),
		...(lowRuns.length ? { lows: sumLows(lowRuns) } : {})
	};
}

/** Sums the hidden candidates of every run that kept them, and the defects only they reported. */
function hiddenTotals(runs: readonly HiddenRun[]): HiddenTotals {
	const totals: HiddenTotals = { candidates: 0, matched: 0, lost: 0 };

	for (const { shown, hidden } of runs) {
		const matched = Object.keys(hidden.found);

		totals.candidates += matched.length + hidden.duplicates.length + hidden.unlabeled.length;
		totals.matched += matched.length;
		totals.lost += matched.filter((id) => !(id in shown.found)).length;
	}

	return totals;
}

export const recall = (totals: Totals) => (totals.planted ? totals.found / totals.planted : 0);

/**
 * Duplicates are neither right nor wrong, so precision weighs only matched and
 * unlabeled findings. It is a lower bound: an unlabeled finding may be a real
 * issue the generator didn't plant.
 */
export const precision = (totals: Totals) =>
	totals.found + totals.unlabeled ? totals.found / (totals.found + totals.unlabeled) : 0;
