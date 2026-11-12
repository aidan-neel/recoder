import { z } from 'zod';
import type { FindingTopic, LearnedRuleProposal, LearnedRuleState } from '@recoder/shared';
import { learnedTable } from './learned-table.js';

/** The most proposals a repository keeps; past this many the oldest are dropped. */
const MAX_PROPOSALS_PER_REPO = 200;

const table = learnedTable<LearnedRuleProposal>({
	setting: 'learned-rules',
	file: 'learned-rules.json',
	schema: z.record(
		z.string(),
		z.array(
			z.object({
				repoId: z.string(),
				topic: z.object({ id: z.string(), label: z.string() }),
				state: z.enum(['proposed', 'approved', 'rejected']),
				votes: z.object({ dismissed: z.number(), useful: z.number() }),
				proposedAt: z.string(),
				decidedAt: z.string().optional()
			})
		)
	)
});

/** A repository's learned-rule proposals, newest first. */
export function listProposals(repoId: string): LearnedRuleProposal[] {
	return table.read()[repoId] ?? [];
}

/** The topics whose quieting a person approved in the repository. */
export function approvedTopics(repoId: string): ReadonlySet<string> {
	return new Set(
		listProposals(repoId)
			.filter((proposal) => proposal.state === 'approved')
			.map((proposal) => proposal.topic.id)
	);
}

/**
 * Proposes quieting `topic` in the repository, with the votes that call for
 * it. A topic waiting for a person gets its counts brought up to date; one a
 * person already approved or rejected keeps their decision, so Recoder never
 * asks again about what someone settled.
 */
export function proposeQuieting(
	repoId: string,
	topic: Pick<FindingTopic, 'id' | 'label'>,
	votes: LearnedRuleProposal['votes']
): void {
	const saved = table.read();
	const held = saved[repoId] ?? [];
	const existing = held.find((proposal) => proposal.topic.id === topic.id);

	if (existing && existing.state !== 'proposed') return;

	const proposal: LearnedRuleProposal = {
		repoId,
		topic: { id: topic.id, label: topic.label },
		state: 'proposed',
		votes,
		proposedAt: new Date().toISOString()
	};

	const others = held.filter((entry) => entry.topic.id !== topic.id);

	saved[repoId] = [proposal, ...others].slice(0, MAX_PROPOSALS_PER_REPO);
	table.write(saved);
}

/**
 * Records a person's approval or rejection of the topic's proposal; any state
 * may change to another, so a rejected rule can be approved later. Undefined
 * when the repository has no proposal for the topic.
 */
export function decideProposal(
	repoId: string,
	topicId: string,
	state: Exclude<LearnedRuleState, 'proposed'>
): LearnedRuleProposal | undefined {
	const saved = table.read();
	const held = saved[repoId] ?? [];
	const existing = held.find((proposal) => proposal.topic.id === topicId);

	if (!existing) return undefined;

	const decided: LearnedRuleProposal = { ...existing, state, decidedAt: new Date().toISOString() };

	saved[repoId] = held.map((proposal) => (proposal === existing ? decided : proposal));
	table.write(saved);

	return decided;
}

/**
 * Forgets the topic's proposal, whatever its state, so the topic is proposed
 * again only once new dismissals call for it; false when none was held.
 */
export function forgetProposal(repoId: string, topicId: string): boolean {
	const saved = table.read();
	const held = saved[repoId] ?? [];
	const kept = held.filter((proposal) => proposal.topic.id !== topicId);

	if (kept.length === held.length) return false;

	saved[repoId] = kept;
	table.write(saved);

	return true;
}
