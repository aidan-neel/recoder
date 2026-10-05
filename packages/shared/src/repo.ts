/** Where a repo's pull requests live; `local` reads them from a git repo plus `recoder-forge.json`. */
export type Provider = 'github' | 'gitlab' | 'local';

export interface Repo {
	id: string;
	name: string;
	url: string;
	provider: Provider;
	defaultBranch: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateRepoInput {
	name: string;
	url: string;
	provider?: Provider;
	defaultBranch?: string;
}
