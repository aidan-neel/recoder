import type { LearnedRuleDecision, LearnedRuleProposal } from '@recoder/shared';
import { create } from 'zustand';

import { guidelinesApi } from '../api/guidelines';
import { failureText } from '../api/http';

/** Where a repository's learned rules stand. */
type LearnedRulesStatus = 'loading' | 'ready' | 'failed';

/** One proposal with the decision being saved on it, if any. */
export interface LearnedRuleEntry {
	proposal: LearnedRuleProposal;
	/** The decision being saved, or null. */
	pending: LearnedRuleDecision['state'] | null;
	/** Why the last decision was refused, or null. */
	error: string | null;
}

interface LearnedRulesStore {
	/** The repository the rules on screen belong to. */
	repoId: string | null;
	status: LearnedRulesStatus;
	/** Why the load failed, as the server put it. */
	error: string | null;
	rules: LearnedRuleEntry[];
	/** Reads the repository's proposals; an answer for an earlier repository is dropped. */
	load: (repoId: string) => Promise<void>;
	/**
	 * Saves a person's decision; the server's answer replaces the proposal.
	 * A failure leaves the row as it was with the reason. A second decide
	 * while one is pending does nothing.
	 */
	decide: (repoId: string, topicId: string, state: LearnedRuleDecision['state']) => Promise<void>;
}

/** A repository's learned rules, as the rules screen shows them. */
export const useLearnedRulesStore = create<LearnedRulesStore>((set, get) => {
	/** The newest load asked for; an older answer that lands late is dropped. */
	let latest = 0;

	function patch(topicId: string, change: (entry: LearnedRuleEntry) => LearnedRuleEntry): void {
		set((current) => ({
			rules: current.rules.map((entry) => (entry.proposal.topic.id === topicId ? change(entry) : entry))
		}));
	}

	return {
		repoId: null,
		status: 'loading',
		error: null,
		rules: [],

		async load(repoId) {
			const ticket = ++latest;

			set({ repoId, status: 'loading', error: null, rules: [] });

			try {
				const proposals = await guidelinesApi.learnedRules(repoId);

				if (ticket !== latest) return;

				set({
					status: 'ready',
					rules: proposals.map((proposal) => ({ proposal, pending: null, error: null })),
					error: null
				});
			} catch (error) {
				if (ticket !== latest) return;

				set({ status: 'failed', error: failureText(error, 'Learned rules didn’t load.') });
			}
		},

		async decide(repoId, topicId, state) {
			const entry = get().rules.find((candidate) => candidate.proposal.topic.id === topicId);

			if (!entry || entry.pending) return;

			patch(topicId, (current) => ({ ...current, pending: state, error: null }));

			try {
				const proposal = await guidelinesApi.decideLearnedRule(repoId, topicId, state);

				if (get().repoId !== repoId) return;

				patch(topicId, () => ({ proposal, pending: null, error: null }));
			} catch (error) {
				if (get().repoId !== repoId) return;

				patch(topicId, (current) => ({
					...current,
					pending: null,
					error: failureText(error, 'Couldn’t save the decision.')
				}));
			}
		}
	};
});
