'use client';

import { useConnections } from '../connections/connections-store';
import { signedInForges } from '../connections/forges';
import { repoDescription } from './step-text';

/** Everything the repository step shows and does. */
export interface RepoStepView {
	/** At least one forge is signed in; the step then opens the repo browser, else it offers to connect one. */
	signedIn: boolean;
	/** The step's one line under its title. */
	description: string;
}

/**
 * First run, step three: a repository to review. With a forge signed in it
 * opens the repo browser; without one it offers to connect GitHub or GitLab,
 * or to add a repository by URL.
 */
export function useRepoStep(done: boolean): RepoStepView {
	const repos = useConnections((state) => state.repos);
	const signedIn = useConnections((state) => signedInForges(state.auth).length > 0);

	return {
		signedIn,
		description: repoDescription({ done, names: (repos ?? []).map((repo) => repo.name) })
	};
}
