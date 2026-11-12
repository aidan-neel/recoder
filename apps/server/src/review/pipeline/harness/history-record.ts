import { recordHistory, type HistorySource } from '../../../models/metrics.js';
import type { IntentSource, IntentSourceKind } from '../intent/types.js';
import type { ReviewRun } from './context.js';

/** The brief's sources that come from the repository's history, not from this PR's own page. */
const HISTORY_KINDS: ReadonlySet<IntentSourceKind> = new Set(['pr-history', 'past-review', 'related-review']);

/**
 * Records on the pipeline run what people taught this repository's reviews:
 * the dismissals candidates are matched against and the votes that rank rules.
 * A review without a repository reads neither, so it records neither.
 */
export function recordLearnedHistory(run: ReviewRun): void {
	if (!run.input.repoId) return;

	recordHistory({
		dismissals: run.dismissals.map((dismissal) => dismissal.fingerprint),
		topics: Object.fromEntries(run.topicTallies)
	});
}

/**
 * Records on the pipeline run which history sources the brief was given,
 * without their text, `history:unavailable` included; an empty list when it
 * was given none.
 */
export function recordHistorySources(sources: IntentSource[]): void {
	recordHistory({ sources: sources.filter((source) => HISTORY_KINDS.has(source.kind)).map(historySource) });
}

function historySource(source: IntentSource): HistorySource {
	const { kind, ref, revision, range, recorded } = source;

	return {
		kind,
		ref,
		...(revision && { revision }),
		...(range && { range }),
		...(recorded !== undefined && { recorded })
	};
}
