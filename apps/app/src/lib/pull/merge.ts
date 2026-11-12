import type { PullMergeMethod, PullPage } from '@recoder/shared';

import { failureText } from '../api/http';
import { readStored, writeStored } from '../shell/browser-storage';
import type { SessionContext } from './session-state';
import type { MergeBlock } from './types';

/** Where the merge method a person last chose in a repository is kept. */
function methodKey(repoId: string): string {
	return `recoder.merge-method.v1.${repoId}`;
}

/** Why the pull request cannot merge now: the first reason that holds, or null. */
export function mergeBlock(page: PullPage): MergeBlock | null {
	const { status, capabilities } = page;

	if (status.state === 'merged') return 'merged';
	if (status.state === 'closed') return 'closed';
	if (status.draft) return 'draft';
	if (status.mergeability === 'conflicts') return 'conflicts';
	if (status.mergeability === 'blocked') return 'blocked';
	if (capabilities.mergeMethods.length === 0) return 'unavailable';

	return null;
}

/** The method to merge with: the one chosen on this page, else the one last used in the repository, else the first allowed. */
export function chosenMethod(page: PullPage, picked: PullMergeMethod | null): PullMergeMethod | null {
	const allowed = page.capabilities.mergeMethods;
	const remembered = readStored(methodKey(page.repoId));

	return (
		[picked, remembered].find((method): method is PullMergeMethod => allowed.some((one) => one === method)) ??
		allowed[0] ??
		null
	);
}

/** Merging from the merge bar. */
export function createMerge(context: SessionContext, refreshPage: () => Promise<void>) {
	const { client, state, repoId, number } = context;

	function failed(error: string): void {
		state.setState((current) => ({ merge: { ...current.merge, phase: 'failed', error } }));
	}

	return {
		setMethod(method: PullMergeMethod): void {
			state.setState((current) => ({ merge: { ...current.merge, method } }));
			writeStored(methodKey(repoId), method);
		},

		/** Merges at the head the page shows, then reads the page again. A refusal shows as the view's error. */
		async merge(): Promise<void> {
			const page = state.getState().page.value;
			const method = page && chosenMethod(page, state.getState().merge.method);

			if (!page || !method || mergeBlock(page)) return failed('This pull request can’t be merged right now.');

			state.setState((current) => ({ merge: { ...current.merge, phase: 'merging', error: null } }));

			try {
				const result = await client.mergePull(repoId, number, { method, headSha: page.pull.headSha });

				if (!result.merged) return failed(result.message ?? 'The forge refused the merge.');

				state.setState((current) => ({ merge: { ...current.merge, phase: 'merged', error: null } }));
				await refreshPage();
			} catch (error) {
				failed(failureText(error));
			}
		}
	};
}
