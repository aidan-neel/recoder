'use client';

import type { LearnedRuleState } from '@recoder/shared';
import { useEffect, useMemo } from 'react';

import { useLearnedRulesStore, type LearnedRuleEntry } from './learned-rules-store';

/** One learned rule as the rules screen shows it. */
export interface LearnedRuleRow {
	topicId: string;
	/** The topic's name, as findings show it. */
	label: string;
	state: LearnedRuleState;
	votes: { dismissed: number; useful: number };
	proposedAt: string;
	decidedAt: string | null;
	/** The decision being saved, or null. */
	pending: 'approved' | 'rejected' | null;
	/** Why the last decision was refused, or null. */
	error: string | null;
	approve: () => void;
	reject: () => void;
}

/** Everything the learned-rules list shows and does for one repository. */
export interface LearnedRulesView {
	status: 'loading' | 'ready' | 'failed';
	/** Why the load failed, or null. */
	error: string | null;
	/** Proposed rules first, then decided ones; newest first inside each group. */
	rules: LearnedRuleRow[];
	/** How many rules wait for a decision. */
	proposed: number;
	retry: () => void;
}

/** One stored proposal as a row, with its decide actions bound to `repoId`. */
function rowOf(entry: LearnedRuleEntry, repoId: string): LearnedRuleRow {
	const { proposal } = entry;

	return {
		topicId: proposal.topic.id,
		label: proposal.topic.label,
		state: proposal.state,
		votes: proposal.votes,
		proposedAt: proposal.proposedAt,
		decidedAt: proposal.decidedAt ?? null,
		pending: entry.pending,
		error: entry.error,
		approve: () => void useLearnedRulesStore.getState().decide(repoId, proposal.topic.id, 'approved'),
		reject: () => void useLearnedRulesStore.getState().decide(repoId, proposal.topic.id, 'rejected')
	};
}

/**
 * The rules Recoder learned for `repoId`: proposals waiting for a person,
 * then decided ones, each newest first. It loads when `repoId` changes and
 * drops an answer that arrives for an earlier one. A decision is not
 * optimistic: the row shows `pending`, then the server's answer replaces it;
 * a failure leaves the row as it was with the reason in `error`.
 */
export function useLearnedRules(repoId: string): LearnedRulesView {
	const storeRepoId = useLearnedRulesStore((state) => state.repoId);
	const status = useLearnedRulesStore((state) => state.status);
	const error = useLearnedRulesStore((state) => state.error);
	const rules = useLearnedRulesStore((state) => state.rules);
	const load = useLearnedRulesStore((state) => state.load);

	useEffect(() => {
		void load(repoId);
	}, [repoId, load]);

	const current = storeRepoId === repoId;

	return useMemo(() => {
		const entries = current ? rules : [];

		const rows = [
			...entries.filter((entry) => entry.proposal.state === 'proposed'),
			...entries.filter((entry) => entry.proposal.state !== 'proposed')
		].map((entry) => rowOf(entry, repoId));

		return {
			status: current ? status : 'loading',
			error: current ? error : null,
			rules: rows,
			proposed: entries.filter((entry) => entry.proposal.state === 'proposed').length,
			retry: () => void load(repoId)
		};
	}, [current, status, error, rules, repoId, load]);
}
