import { z } from 'zod';
import type { Finding } from '@recoder/shared';
import { learnedTable } from './learned-table.js';

/** What a person did with a finding: accepted or sent it (`useful`), or dismissed it. */
export type VoteChoice = 'useful' | 'dismissed';

/** One person's decision on one finding, counted toward the finding's topic in its repository. */
export interface Vote {
	/** The finding's fingerprint, else its id, so deciding the same finding in a later review replaces the vote. */
	findingKey: string;
	/** The topic's id (`FindingTopic.id`). */
	topic: string;
	choice: VoteChoice;
	votedAt: string;
}

/** How a repository's people decided one topic's findings. */
export interface TopicTally {
	useful: number;
	dismissed: number;
}

/** The newest votes kept for each repository. */
const MAX_VOTES_PER_REPO = 1000;

const table = learnedTable<Vote>({
	setting: 'finding-votes',
	file: 'finding-votes.json',
	schema: z.record(
		z.string(),
		z.array(
			z.object({
				findingKey: z.string(),
				topic: z.string(),
				choice: z.enum(['useful', 'dismissed']),
				votedAt: z.string()
			})
		)
	)
});

/** What a vote on the finding is held under: its fingerprint, which a later review of the same code shares, else its id. */
export function voteKeyOf(finding: Finding): string {
	return finding.fingerprint ?? finding.id;
}

/** Remembers a vote as the newest of its repository, replacing an earlier vote on the same finding. */
export function recordVote(repoId: string, vote: Vote): void {
	const saved = table.read();
	const others = (saved[repoId] ?? []).filter((held) => held.findingKey !== vote.findingKey);

	saved[repoId] = [vote, ...others].slice(0, MAX_VOTES_PER_REPO);
	table.write(saved);
}

/**
 * Forgets the finding's vote when it is `choice`, and leaves any other vote,
 * so taking back an accept never undoes a later dismissal; false when no such
 * vote was held.
 */
export function removeVote(repoId: string, findingKey: string, choice: VoteChoice): boolean {
	const saved = table.read();
	const held = saved[repoId] ?? [];
	const kept = held.filter((vote) => vote.findingKey !== findingKey || vote.choice !== choice);

	if (kept.length === held.length) return false;

	saved[repoId] = kept;
	table.write(saved);

	return true;
}

/** Forgets the repository's dismissals of a topic, so the topic is quiet again only after new ones; how many went. */
export function forgetDismissedVotes(repoId: string, topic: string): number {
	const saved = table.read();
	const held = saved[repoId] ?? [];
	const kept = held.filter((vote) => vote.topic !== topic || vote.choice !== 'dismissed');

	if (kept.length === held.length) return 0;

	saved[repoId] = kept;
	table.write(saved);

	return held.length - kept.length;
}

/** Each topic's votes in the repository, by topic id. */
export function topicTallies(repoId: string): ReadonlyMap<string, TopicTally> {
	const tallies = new Map<string, TopicTally>();

	for (const vote of table.read()[repoId] ?? []) {
		const tally = tallies.get(vote.topic) ?? { useful: 0, dismissed: 0 };

		tallies.set(vote.topic, { ...tally, [vote.choice]: tally[vote.choice] + 1 });
	}

	return tallies;
}
