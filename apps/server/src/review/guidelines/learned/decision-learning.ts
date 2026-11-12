import { splitCategoryTag, type DismissalReason, type Finding, type FindingDecision } from '@recoder/shared';
import { matchesDismissal } from '../../pipeline/harness/findings.js';
import { recordDismissal, removeDismissal } from './dismissals.js';
import type { LearningKeys } from './finding-key.js';
import { proposeQuieting } from './proposals.js';
import { isDismissedOften } from './topics.js';
import { recordVote, removeVote, topicTallies } from './votes.js';

/** A finding a person decided, with the repository it belongs to and the keys its decision is learned under. */
export interface DecidedFinding {
	repoId: string;
	finding: Finding;
	/** What this decision is learned under (`learningKeys` of the finding as its review stores it). */
	keys: LearningKeys;
	/**
	 * What a decision on the same finding in an earlier review of the pull
	 * request was learned under. History keeps a finding's id across pushes
	 * while its fingerprint, category and line text may change, so these keys
	 * can differ from `keys`.
	 */
	earlierKeys: LearningKeys[];
}

/**
 * Reasons that stop the same finding from being raised again in the
 * repository. Each one says a person settled this defect: it is false
 * (`wrong`), not worth the change, handled elsewhere, or against how the
 * repository is written. The match is narrow, as `matchesDismissal` reads it:
 * one repository, one place and one behaviour, never a whole topic. A
 * `duplicate` says only that another finding covers it, so it stops nothing:
 * the other finding carries the decision.
 */
const STOPS_THE_FINDING: ReadonlySet<DismissalReason> = new Set([
	'wrong',
	'not-worth-fixing',
	'already-handled',
	'style-preference'
]);

/**
 * Reasons that also count as a dismissed vote toward the finding's topic, and
 * so toward proposing to quiet it. Each one judges the kind of finding: false,
 * not worth fixing here, or a style this repository does not hold. `already-handled`
 * and `duplicate` judge only this one finding and say nothing of its topic.
 */
const COUNTS_TOWARD_TOPIC: ReadonlySet<DismissalReason> = new Set(['wrong', 'not-worth-fixing', 'style-preference']);

const MAX_TITLE_CHARS = 200;

/**
 * Learns from a person's decision: an acceptance is a useful vote on the
 * finding's topic; a dismissal remembers the finding and votes against its
 * topic as its reason says (`STOPS_THE_FINDING`, `COUNTS_TOWARD_TOPIC`). A
 * dismissed vote that leaves the topic dismissed often proposes quieting it,
 * which applies only once a person approves. What an earlier decision on the
 * same finding taught is forgotten first, so changing a decision never counts twice.
 */
export function learnFromDecision(decided: DecidedFinding, decision: FindingDecision): void {
	forgetDecision(decided);

	if (decision.state === 'accepted') {
		vote(decided, 'useful', decision.decidedAt);

		return;
	}

	if (decision.reason && STOPS_THE_FINDING.has(decision.reason)) rememberDismissal(decided, decision);
	if (decision.reason && COUNTS_TOWARD_TOPIC.has(decision.reason)) voteDismissed(decided, decision.decidedAt);
}

/**
 * Forgets what a decision on the finding taught, in this review or an earlier
 * one of the pull request: its remembered dismissal, in either key form
 * `matchesDismissal` reads, and its vote either way. The dismissal of another
 * finding split from the same line stays.
 */
export function forgetDecision({ repoId, keys, earlierKeys }: DecidedFinding): void {
	const learned = [keys, ...earlierKeys];

	removeDismissal(repoId, (held) => learned.some((key) => matchesDismissal(held, key.dismissal)));

	for (const vote of new Set(learned.map((key) => key.vote))) {
		removeVote(repoId, vote, 'useful');
		removeVote(repoId, vote, 'dismissed');
	}
}

/** The title a person saw on the finding: its own, else the first line of its message. */
function titleOf(finding: Finding): string {
	const title = finding.title ?? splitCategoryTag(finding.message).body.split('\n')[0];

	return title.slice(0, MAX_TITLE_CHARS);
}

/** Remembers the dismissed finding, so later reviews of the repository drop it. */
function rememberDismissal({ repoId, finding, keys }: DecidedFinding, decision: FindingDecision): void {
	recordDismissal({
		repoId,
		fingerprint: keys.dismissal,
		file: finding.file,
		category: finding.category ?? '',
		title: titleOf(finding),
		...(decision.reason ? { reason: decision.reason } : {}),
		...(decision.note ? { note: decision.note } : {}),
		dismissedAt: decision.decidedAt
	});
}

/** Counts the decision toward the finding's topic; a finding without a topic counts toward none. */
function vote({ repoId, finding, keys }: DecidedFinding, choice: 'useful' | 'dismissed', votedAt: string): void {
	if (!finding.topic) return;

	recordVote(repoId, { findingKey: keys.vote, topic: finding.topic.id, choice, votedAt });
}

/** Votes against the finding's topic, and proposes quieting the topic once people dismiss it often. */
function voteDismissed(decided: DecidedFinding, votedAt: string): void {
	const { repoId, finding } = decided;

	vote(decided, 'dismissed', votedAt);

	if (!finding.topic) return;

	const tally = topicTallies(repoId).get(finding.topic.id);

	if (tally && isDismissedOften(tally)) {
		proposeQuieting(repoId, finding.topic, { dismissed: tally.dismissed, useful: tally.useful });
	}
}
