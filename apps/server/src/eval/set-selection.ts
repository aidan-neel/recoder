import { basename } from 'node:path';
import type { BenchmarkReport, ScoredRun } from './benchmark-report';
import { summarize, type LabeledDefect, type Totals } from './benchmark-score';
import { byId, type TaskSet } from './task-set';

/** What selection reads of a label file. */
interface SelectionLabel {
	id: string;
	codebase: string;
	defects: LabeledDefect[];
}

/** A report the selection learns from, under its file path. */
export interface SourceReport {
	path: string;
	report: BenchmarkReport;
}

/** A labeled PR with what the input reports say about it. */
interface Candidate {
	id: string;
	codebase: string;
	control: boolean;
	/** Defects published in some judged run of the input reports and not in another. */
	disagreed: number;
	/** Defects some run's candidate reported that no shown finding of that run did. */
	lost: number;
	/** A control's spread in published findings across runs; zero for a PR with defects. */
	noise: number;
	weakTests: number;
	boundary: number;
}

/** One selected PR and why it was chosen. */
export interface Pick {
	id: string;
	reasons: string[];
}

/**
 * Titles that name an edge-of-range defect. The labels carry no boundary
 * category, so the title is the only deterministic signal.
 */
const BOUNDARY = /off-by-one|boundary|exactly|fencepost|inclusive|exclusive/i;

const RULE =
	'Rank PRs by defects published in some judged run and not another plus defects a candidate found that no shown finding reported, ties by id; take the best PR for each codebase, then for a tests-category label, a title naming a boundary (off-by-one, boundary, exactly, fencepost, inclusive, exclusive) and a control (ranked by spread in published findings), then fill by rank.';

function judgedRuns(id: string, reports: readonly SourceReport[]): ScoredRun[] {
	return reports.flatMap(({ report }) => report.prs.find((pr) => pr.id === id)?.runs.filter((run) => run.score) ?? []);
}

function candidate(label: SelectionLabel, reports: readonly SourceReport[]): Candidate {
	const runs = judgedRuns(label.id, reports);
	const published = (run: ScoredRun, id: string) => id in run.score!.found;
	const shownCounts = runs.map((run) => run.findings.length);

	const disagreed = label.defects.filter(
		({ id }) => runs.some((run) => published(run, id)) && runs.some((run) => !published(run, id))
	);

	const lost = label.defects.filter(({ id }) => runs.some((run) => run.stages?.[id]?.found && !published(run, id)));

	return {
		id: label.id,
		codebase: label.codebase,
		control: label.defects.length === 0,
		disagreed: disagreed.length,
		lost: lost.length,
		noise: shownCounts.length ? Math.max(...shownCounts) - Math.min(...shownCounts) : 0,
		weakTests: label.defects.filter((defect) => defect.category === 'tests').length,
		boundary: label.defects.filter((defect) => BOUNDARY.test(defect.title)).length
	};
}

/** A PR ranks by the defects it disagreed on plus those it lost, a control by its spread in published findings. */
const weight = (item: Candidate) => (item.control ? item.noise : item.disagreed + item.lost);

/** PRs with defects by weight, then controls by weight, ties by id. */
function ranked(candidates: Candidate[]): Candidate[] {
	return candidates.sort((a, b) => Number(a.control) - Number(b.control) || weight(b) - weight(a) || byId(a.id, b.id));
}

function reasonsOf(item: Candidate): string[] {
	if (item.control) return [`control, published findings spread ${item.noise}`];

	return [
		`${item.disagreed} disagreed`,
		`${item.lost} lost after the candidate stage`,
		`codebase ${item.codebase}`,
		...(item.weakTests ? ['weak-test label'] : []),
		...(item.boundary ? ['boundary label'] : [])
	];
}

/** Refuses reports of another dataset, whose PR ids would name other changes. */
function checkSources(dataset: string, reports: readonly SourceReport[]): void {
	const foreign = reports.filter(({ report }) => report.dataset !== dataset);

	if (foreign.length)
		throw new Error(
			`Not from dataset ${dataset}: ${foreign.map(({ path, report }) => `${basename(path)} (${report.dataset})`).join(', ')}.`
		);
}

/**
 * The task set of `size` PRs the input reports learn most from, with why each
 * was picked. Identical labels and reports give an identical set: there is no
 * clock or randomness, and `selectedAt` is the newest report's finish time.
 */
export function selectSet(
	dataset: string,
	labels: readonly SelectionLabel[],
	reports: readonly SourceReport[],
	options: { size: number; name: string }
): { set: TaskSet; picks: Pick[] } {
	checkSources(dataset, reports);

	const order = ranked(labels.map((label) => candidate(label, reports)));
	const picked: Candidate[] = [];

	const needs: ((item: Candidate) => boolean)[] = [
		...[...new Set(labels.map((label) => label.codebase))]
			.sort()
			.map((codebase) => (item: Candidate) => !item.control && item.codebase === codebase),
		(item) => item.weakTests > 0,
		(item) => item.boundary > 0,
		(item) => item.control
	];

	for (const fits of needs) {
		const best = picked.some(fits) ? undefined : order.find(fits);

		if (best) picked.push(best);
	}

	if (picked.length > options.size)
		throw new Error(
			`--size ${options.size} cannot hold every codebase, a weak test, a boundary and a control; it needs ${picked.length}.`
		);

	picked.push(...order.filter((item) => !picked.includes(item)).slice(0, options.size - picked.length));
	picked.sort((a, b) => byId(a.id, b.id));

	return {
		set: {
			name: options.name,
			tasks: picked.map((item) => item.id),
			sources: reports.map(({ path }) => basename(path)).sort(),
			selectedAt:
				reports
					.map(({ report }) => report.finishedAt)
					.sort()
					.at(-1) ?? '',
			rule: RULE
		},
		picks: picked.map((item) => ({ id: item.id, reasons: reasonsOf(item) }))
	};
}

/** A report's found-over-planted on the set's PRs next to the same on every PR. */
export function tracking(report: BenchmarkReport, tasks: readonly string[]): { subset: Totals; full: Totals } {
	const totals = (prs: BenchmarkReport['prs']) =>
		summarize(
			prs.map((pr) => ({
				codebase: pr.codebase,
				defects: pr.defects,
				scores: pr.runs.flatMap((run) => (run.score ? [run.score] : []))
			}))
		).overall;

	return { subset: totals(report.prs.filter((pr) => tasks.includes(pr.id))), full: totals(report.prs) };
}
