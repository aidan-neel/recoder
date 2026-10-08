import { settle } from './benchmark-judge';
import { matchAdjudication, matchKey, type Adjudications } from './benchmark-labels';
import type { LabeledDefect, MatchCorrection, PrScore } from './benchmark-score';
import { claimHash } from './claim';
import type { EvalFinding } from './metrics';

/** A defect's match and the findings that repeat it, as a correction rewrites them. */
interface Calls {
	found: Record<string, number>;
	repeats: Record<string, number[]>;
}

function claimedBy({ found }: Calls, index: number): string | undefined {
	return Object.keys(found).find((id) => found[id] === index);
}

/** A human says the finding reports the defect: it becomes the match when the defect has none and the finding is free, a repeat otherwise. */
function credit(calls: Calls, id: string, index: number): void {
	const repeats = calls.repeats[id] ?? [];

	if (calls.found[id] === undefined && claimedBy(calls, index) === undefined) {
		calls.found[id] = index;
		calls.repeats[id] = repeats.filter((item) => item !== index);
	} else if (calls.found[id] !== index && !repeats.includes(index)) {
		calls.repeats[id] = [...repeats, index];
	}
}

/** A human says the finding does not report the defect: it loses the match, and the first free repeat no human rejected takes it. */
function withdraw(calls: Calls, id: string, index: number, rejected: (index: number) => boolean): void {
	const repeats = (calls.repeats[id] ?? []).filter((item) => item !== index);

	calls.repeats[id] = repeats;

	if (calls.found[id] !== index) return;

	delete calls.found[id];

	const next = repeats.find((item) => !rejected(item) && claimedBy(calls, item) === undefined);

	if (next === undefined) return;

	calls.found[id] = next;
	calls.repeats[id] = repeats.filter((item) => item !== next);
}

/**
 * The judge's score with the human corrections for these findings applied,
 * each recorded with its reason. A correction names a claim by its hash, so it
 * holds for that text in every run and at every stage. With no correction for
 * these findings, the score is returned as the judge gave it.
 */
export function correctScore(
	pr: string,
	score: PrScore,
	defects: readonly LabeledDefect[],
	findings: readonly EvalFinding[],
	adjudications: Adjudications
): PrScore {
	const hashes = findings.map(claimHash);
	const lookup = (id: string, index: number) => matchAdjudication(adjudications, matchKey(pr, id, hashes[index]!));
	const calls: Calls = { found: { ...score.found }, repeats: structuredClone(score.repeats ?? {}) };
	const applied: MatchCorrection[] = [];

	for (const { id } of defects) {
		hashes.forEach((_, index) => {
			const entry = lookup(id, index);

			if (!entry) return;

			applied.push({ defect: id, finding: index, reports: entry.reports, reason: entry.reason });

			if (entry.reports) credit(calls, id, index);
			else withdraw(calls, id, index, (item) => lookup(id, item)?.reports === false);
		});
	}

	if (!applied.length) return score;

	return settle({ ...score, ...calls, adjudicated: applied }, defects, findings.length);
}
