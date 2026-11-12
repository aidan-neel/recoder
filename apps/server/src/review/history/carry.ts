import type { Finding, FindingHistory, ResolvedFinding } from '@recoder/shared';
import { requieted } from '../guidelines/learned/topics.js';
import { codeChange, shifted, type CodeChange, type DiffFiles } from './code-change.js';
import { defectIdentity, sameDefect, type DefectIdentity } from './identity.js';

/** One review of the pull request as history reads it: its head, its findings and its diff by file. */
export interface ReviewedRevision {
	headSha: string;
	findings: Finding[];
	diff: DiffFiles;
}

/**
 * The new review: its revision, the candidates it hid, whose refuted ones may
 * show an old finding fixed, and the topics a person approved quieting in the
 * repository now, which quiet a carried finding in place of what it held.
 */
export interface NewReview extends ReviewedRevision {
	unconfirmed: Finding[];
	quietedTopics: ReadonlySet<string>;
}

/** The new review's findings with their history, and the earlier findings its evidence shows fixed. */
export interface CarriedHistory {
	findings: Finding[];
	resolved: ResolvedFinding[];
}

/** An earlier finding with what the commits since did to its code and its identity. */
interface Earlier {
	finding: Finding;
	change: CodeChange;
	identity: DefectIdentity;
}

/**
 * The new review's findings, set against the review before it on the same
 * pull request. Each earlier finding is matched one to one by identity
 * (`sameDefect`), never by line or category.
 *
 * - Raised again: the new finding takes the earlier one's id. It is
 *   `rechecked` when the commits since touched its code, else `carried` with
 *   the earlier decision.
 * - Not raised, code untouched: the earlier finding is `carried` as it was,
 *   moved with its code, decision and all, but quieted only as the topics
 *   approved now say (`requieted`).
 * - Not raised, code touched: it is resolved only on new evidence, either a
 *   verifier refuting the same defect in this review or the pull request no
 *   longer changing its file. Otherwise it is `carried` where it was.
 * - Every other new finding is `new` at this head.
 *
 * Keeping the id is what lets an unrelated commit leave a posted comment alone.
 */
export function carryHistory(previous: ReviewedRevision, next: NewReview): CarriedHistory {
	const earlier: Earlier[] = previous.findings.map((finding) => ({
		finding,
		change: codeChange(previous.diff, next.diff, finding),
		identity: defectIdentity(finding, previous.diff)
	}));

	const raised = next.findings.map((finding) => defectIdentity(finding, next.diff));
	const matched = matchEarlier(earlier, raised);
	const sinceOf = (entry: Earlier): string => entry.finding.history?.firstSeenSha ?? previous.headSha;

	const findings = next.findings.map((finding, index) => {
		const entry = matched.get(index);

		return entry ? continued(finding, entry, sinceOf(entry)) : { ...finding, history: historyOf(next.headSha, 'new') };
	});

	const unraised = earlier.filter((entry) => ![...matched.values()].includes(entry));
	const refuted = next.unconfirmed.filter((finding) => finding.verification?.outcome === 'refuted');
	const resolved: ResolvedFinding[] = [];

	for (const entry of unraised) {
		const reason = fixEvidence(entry, refuted, next.diff);

		if (reason) resolved.push({ finding: entry.finding, reason, resolvedAtSha: next.headSha });
		else findings.push(requieted(carried(entry, sinceOf(entry)), next.quietedTopics));
	}

	return { findings, resolved };
}

/** Pairs each new finding, by index, with the first unpaired earlier finding of the same defect. */
function matchEarlier(earlier: Earlier[], raised: DefectIdentity[]): Map<number, Earlier> {
	const matched = new Map<number, Earlier>();
	const taken = new Set<Earlier>();

	raised.forEach((identity, index) => {
		const entry = earlier.find((candidate) => !taken.has(candidate) && sameDefect(candidate.identity, identity));

		if (!entry) return;

		taken.add(entry);
		matched.set(index, entry);
	});

	return matched;
}

function historyOf(firstSeenSha: string, state: FindingHistory['state']): FindingHistory {
	return { firstSeenSha, state };
}

/**
 * A new finding of a defect the earlier review reported: it keeps the earlier
 * id, and a carried one keeps the earlier decision, while a rechecked one is
 * open again for a person to look at.
 */
function continued(finding: Finding, entry: Earlier, since: string): Finding {
	const base = { ...finding, id: entry.finding.id };

	if (entry.change.kind !== 'untouched') return { ...base, history: historyOf(since, 'rechecked') };

	return {
		...base,
		...(entry.finding.decision ? { decision: entry.finding.decision } : {}),
		history: historyOf(since, 'carried')
	};
}

/** An earlier finding this review did not raise and nothing showed fixed, kept as it was and moved with its code. */
function carried(entry: Earlier, since: string): Finding {
	const moved = entry.change.kind === 'untouched' ? shifted(entry.finding, entry.change.lineShift) : entry.finding;

	return { ...moved, history: historyOf(since, 'carried') };
}

/**
 * Why an earlier finding the new review did not raise is fixed, or undefined
 * when nothing new says so. Only touched code can be fixed: a verifier
 * refuting the same defect, or the pull request no longer changing its file.
 */
function fixEvidence(entry: Earlier, refuted: Finding[], after: DiffFiles): string | undefined {
	if (entry.change.kind === 'untouched') return undefined;
	if (entry.change.kind === 'gone') return `The pull request no longer changes ${entry.finding.file}.`;

	const refutation = refuted.find((finding) => sameDefect(entry.identity, defectIdentity(finding, after)));

	return refutation?.verification?.reason;
}
