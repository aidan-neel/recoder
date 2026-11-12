import type { LearnedRuleDecision, LearnedRuleProposal } from '@recoder/shared';
import { create } from 'zustand';

import { guidelinesApi } from '../api/guidelines';
import { failureText } from '../api/http';

/** One proposal with the decision being saved on it, if any. */
export interface LearnedRuleEntry {
	proposal: LearnedRuleProposal;
	/** The decision being saved, or null. */
	pending: LearnedRuleDecision['state'] | null;
	/** Why the last decision was refused, or null. */
	error: string | null;
}

/** One repository's learned rules and where their load stands. */
export interface RepoLearnedRules {
	status: 'loading' | 'ready' | 'failed';
	/** Why the load failed, as the server put it. */
	error: string | null;
	rules: LearnedRuleEntry[];
}

interface LearnedRulesStore {
	/** Each repository's rules by its id; one not asked for yet has no entry. */
	repos: Record<string, RepoLearnedRules>;
	/**
	 * Reads a repository's proposals. Rules already on screen stay until the
	 * new answer lands, and stay when a refresh fails; an older answer that
	 * lands late is dropped.
	 */
	load: (repoId: string) => Promise<void>;
	/**
	 * Saves a person's decision; the server's answer replaces the proposal.
	 * A failure leaves the row as it was with the reason. A second decide
	 * while one is pending does nothing.
	 */
	decide: (repoId: string, topicId: string, state: LearnedRuleDecision['state']) => Promise<void>;
}

/** The learned rules of every repository a screen has asked for. */
export const useLearnedRulesStore = create<LearnedRulesStore>((set, get) => {
	/** The newest load asked for per repository. */
	const latest = new Map<string, number>();

	function setRepo(repoId: string, next: RepoLearnedRules): void {
		set((current) => ({ repos: { ...current.repos, [repoId]: next } }));
	}

	function patchRule(repoId: string, topicId: string, change: (entry: LearnedRuleEntry) => LearnedRuleEntry): void {
		const repo = get().repos[repoId];

		if (!repo) return;

		setRepo(repoId, {
			...repo,
			rules: repo.rules.map((entry) => (entry.proposal.topic.id === topicId ? change(entry) : entry))
		});
	}

	return {
		repos: {},

		async load(repoId) {
			const ticket = (latest.get(repoId) ?? 0) + 1;

			latest.set(repoId, ticket);

			if (!get().repos[repoId]) setRepo(repoId, { status: 'loading', error: null, rules: [] });

			try {
				const proposals = await guidelinesApi.learnedRules(repoId);

				if (latest.get(repoId) !== ticket) return;

				setRepo(repoId, {
					status: 'ready',
					error: null,
					rules: proposals.map((proposal) => ({ proposal, pending: null, error: null }))
				});
			} catch (error) {
				if (latest.get(repoId) !== ticket || get().repos[repoId]?.status === 'ready') return;

				setRepo(repoId, { status: 'failed', error: failureText(error, 'Learned rules didn’t load.'), rules: [] });
			}
		},

		async decide(repoId, topicId, state) {
			const entry = get().repos[repoId]?.rules.find((candidate) => candidate.proposal.topic.id === topicId);

			if (!entry || entry.pending) return;

			patchRule(repoId, topicId, (current) => ({ ...current, pending: state, error: null }));

			try {
				const proposal = await guidelinesApi.decideLearnedRule(repoId, topicId, state);

				patchRule(repoId, topicId, () => ({ proposal, pending: null, error: null }));
			} catch (error) {
				patchRule(repoId, topicId, (current) => ({
					...current,
					pending: null,
					error: failureText(error, 'Couldn’t save the decision.')
				}));
			}
		}
	};
});
