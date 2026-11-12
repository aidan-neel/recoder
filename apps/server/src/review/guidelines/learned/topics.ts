import { createHash } from 'node:crypto';
import { categoryLabel, type Finding, type FindingTopic } from '@recoder/shared';
import type { RepoRule, RuleLedger } from '../ledger/types.js';
import type { TopicTally } from './votes.js';

/** Dismissals a topic needs before it is quiet, so a couple of unlucky findings never quiet a whole topic. */
const MIN_DISMISSALS_TO_QUIET = 3;

/** Dismissals per useful vote that make a topic quiet: people here act on fewer than one in five of its findings. */
const DISMISSALS_PER_USEFUL_TO_QUIET = 4;

/** Useful votes a rule needs before reviewers are told people here act on it. */
const MIN_USEFUL_TO_ENDORSE = 2;

/**
 * A rule's topic id, from its text with case and spacing collapsed. Ledger ids
 * (`R3`) are positions that move whenever the guidelines change; the text is
 * what the feedback was about.
 */
export function ruleTopicId(rule: RepoRule): string {
	const text = rule.text.toLowerCase().replace(/\s+/g, ' ').trim();

	return `rule:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
}

/**
 * What feedback on the finding counts toward: the ledger rule it cites, the
 * smell it names, or else its category. Undefined for an older finding with no
 * category.
 */
function topicOf(finding: Finding, ledger: RuleLedger | null): FindingTopic | undefined {
	const rule = finding.ruleId ? ledger?.rules.find((entry) => entry.id === finding.ruleId) : undefined;

	if (rule) return { id: ruleTopicId(rule), label: rule.text };
	if (finding.smell) return { id: `smell:${finding.smell}`, label: categoryLabel(finding.smell) };
	if (finding.category) return { id: `category:${finding.category}`, label: categoryLabel(finding.category) };

	return undefined;
}

/**
 * Whether people in the repository dismiss this topic's findings far more
 * often than they act on them. It proposes quieting the topic and ranks its
 * rule last, but never quiets it: only a person's approval does that.
 */
export function isDismissedOften(tally: TopicTally | undefined): boolean {
	if (!tally) return false;

	return tally.dismissed >= MIN_DISMISSALS_TO_QUIET && tally.dismissed >= DISMISSALS_PER_USEFUL_TO_QUIET * tally.useful;
}

/** Whether a run of code showed the problem; such a finding is real whatever people said about its topic. */
function isRunProven(finding: Finding): boolean {
	return finding.verification?.status === 'verified' && finding.verification.method === 'run';
}

/**
 * The findings with their topics, and quieted where a person approved
 * quieting the topic in the repository. A finding a run proved is never quieted.
 */
export function withTopics(
	findings: Finding[],
	ledger: RuleLedger | null,
	tallies: ReadonlyMap<string, TopicTally>
): Finding[] {
	return findings.map((finding) => {
		const topic = topicOf(finding, ledger);

		if (!topic) return finding;

		return { ...finding, topic: quietedAsApproved(finding, topic, tallies.get(topic.id)?.quietApproved === true) };
	});
}

/**
 * The finding quieted as the repository's approvals say now, whatever it held
 * before: quieted when its topic is one of `approvedTopics` and no run proved
 * it, shown otherwise. A finding carried from an earlier review is read again
 * this way, so a rule that was rejected since, or a finding quieted before
 * approvals existed, does not stay quiet.
 */
export function requieted(finding: Finding, approvedTopics: ReadonlySet<string>): Finding {
	if (!finding.topic) return finding;

	return { ...finding, topic: quietedAsApproved(finding, finding.topic, approvedTopics.has(finding.topic.id)) };
}

/** The finding's topic, quieted when a person approved quieting it and no run proved the finding. */
function quietedAsApproved(finding: Finding, topic: FindingTopic, isApproved: boolean): FindingTopic {
	const { quieted: _held, ...shown } = topic;

	return isApproved && !isRunProven(finding) ? { ...shown, quieted: true } : shown;
}

/** How a rule stands with the repository's people, or undefined while their votes say nothing either way. */
function standingOf(tally: TopicTally | undefined): RepoRule['standing'] {
	if (isDismissedOften(tally)) return 'often-dismissed';
	if (tally && tally.useful >= MIN_USEFUL_TO_ENDORSE && tally.useful > tally.dismissed) return 'acted-on';

	return undefined;
}

/** Useful votes less dismissals; a rule nobody voted on scores zero. */
function score(tally: TopicTally | undefined): number {
	return tally ? tally.useful - tally.dismissed : 0;
}

/**
 * The ledger with its rules in the order reviewers should weigh them: the
 * ones people here act on first, the ones they keep dismissing last, the
 * rest in source order between. Each rule keeps its id, so findings cite it
 * as before.
 */
export function rankRules(ledger: RuleLedger | null, tallies: ReadonlyMap<string, TopicTally>): RuleLedger | null {
	if (!ledger) return null;

	const ranked = ledger.rules.map((rule, index) => {
		const tally = tallies.get(ruleTopicId(rule));

		return { rule: { ...rule, standing: standingOf(tally) }, score: score(tally), index };
	});

	ranked.sort((a, b) => b.score - a.score || a.index - b.index);

	return { ...ledger, rules: ranked.map((entry) => entry.rule) };
}
