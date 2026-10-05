import { PUBLISHED_BY, type PublishedBy } from '../review/pipeline/published-by';
import type { PrScore } from './benchmark-score';

/** What the judge made of the shown findings that were below the reporting bar and published for one reason. */
interface LowTally {
	/** Shown findings published below the bar for this reason. */
	published: number;
	/** Of those, findings that report a planted defect. */
	matched: number;
	/** Of those, findings that restate a defect another finding already found. */
	duplicates: number;
	/** Of those, findings that report no planted defect. */
	unlabeled: number;
}

/** Published below-bar findings by the reason each was published. */
export type LowTotals = Record<PublishedBy, LowTally>;

/** A candidate as the eval reads it: its id, and why it is published below the bar when it is. */
interface CandidateReason {
	id: string;
	publishedBy?: PublishedBy;
}

function emptyLows(): LowTotals {
	return Object.fromEntries(
		PUBLISHED_BY.map((reason) => [reason, { published: 0, matched: 0, duplicates: 0, unlabeled: 0 }])
	) as LowTotals;
}

/**
 * Counts a run's shown findings that were below the reporting bar, by the
 * reason each was published, against the judge's call on the shown findings.
 * `findingIds` lines up with the findings the judge scored, and a finding is
 * the candidate with its id. No second match is made.
 */
export function lowsOfRun(
	findingIds: readonly string[],
	candidates: readonly CandidateReason[],
	score: PrScore
): LowTotals {
	const reasons = new Map(
		candidates.flatMap(({ id, publishedBy }) => (publishedBy ? [[id, publishedBy] as const] : []))
	);

	const totals = emptyLows();

	const count = (indexes: Iterable<number>, key: keyof LowTally) => {
		for (const index of new Set(indexes)) {
			const reason = reasons.get(findingIds[index] ?? '');

			if (reason) totals[reason][key]++;
		}
	};

	count(findingIds.keys(), 'published');
	count(Object.values(score.found), 'matched');
	count(score.duplicates, 'duplicates');
	count(score.unlabeled, 'unlabeled');

	return totals;
}

/** Sums runs' tallies. */
export function sumLows(runs: readonly LowTotals[]): LowTotals {
	const total = emptyLows();

	for (const run of runs) {
		for (const reason of PUBLISHED_BY) {
			for (const key of Object.keys(total[reason]) as (keyof LowTally)[]) total[reason][key] += run[reason][key];
		}
	}

	return total;
}
