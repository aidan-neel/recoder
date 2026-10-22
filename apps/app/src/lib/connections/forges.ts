import type { ProviderAuth } from '@recoder/shared';

import type { Forge } from '../api/connections';

/** One forge Recoder can read pull requests from, with the copy its token dialog shows. */
export interface ForgeInfo {
	id: Forge;
	label: string;
	/** The scopes the token needs. */
	scope: string;
	placeholder: string;
	/** The forge's CLI, which Recoder also picks up a sign-in from. */
	cli: string;
}

export const FORGES: readonly ForgeInfo[] = [
	{ id: 'github', label: 'GitHub', scope: 'Needs the repo scope.', placeholder: 'ghp_… or github_pat_…', cli: 'gh' },
	{
		id: 'gitlab',
		label: 'GitLab',
		scope: 'Needs read_api and read_repository.',
		placeholder: 'glpat-…',
		cli: 'glab'
	}
];

/** "GitHub" or "GitLab". */
export function forgeLabel(id: Forge): string {
	return FORGES.find((forge) => forge.id === id)?.label ?? id;
}

/** The forges with a working sign-in, GitHub first. */
export function signedInForges(auth: Record<Forge, ProviderAuth> | null): Forge[] {
	if (!auth) return [];

	return FORGES.map((forge) => forge.id).filter((id) => auth[id].authenticated);
}
