import type { GuidelinesOverview, GuidelinesProposal, RepoGuidelines } from '@recoder/shared';
import { serverApi } from '$lib/server-api';

export type GuidelinesScope = { kind: 'global' } | { kind: 'repo'; repoId: string };

type RepoState =
	| { status: 'loading' }
	| { status: 'ready'; data: RepoGuidelines }
	| { status: 'error'; error: string };

/**
 * Owner review guidelines on the client: the overview (global layer, repos),
 * each repo's `.recoder/REVIEW.md` status, and which editor is open.
 */
class GuidelinesStore {
	overview = $state<GuidelinesOverview | null>(null);
	loadError = $state<string | null>(null);
	repos = $state<Record<string, RepoState>>({});
	/** The open editor, or null. One editor at a time, mounted in the layout. */
	editing = $state<GuidelinesScope | null>(null);

	async load(): Promise<GuidelinesOverview | null> {
		try {
			this.overview = await serverApi.getGuidelines();
			this.loadError = null;
		} catch (e) {
			this.loadError = e instanceof Error ? e.message : 'Could not load guidelines.';
		}
		return this.overview;
	}

	async loadRepo(repoId: string): Promise<RepoGuidelines | null> {
		if (this.repos[repoId]?.status !== 'ready') this.repos[repoId] = { status: 'loading' };
		try {
			const data = await serverApi.getRepoGuidelines(repoId);
			this.repos[repoId] = { status: 'ready', data };
			return data;
		} catch (e) {
			this.repos[repoId] = { status: 'error', error: e instanceof Error ? e.message : 'Could not read the repository.' };
			return null;
		}
	}

	repoName(repoId: string): string {
		return this.overview?.repos.find((repo) => repo.id === repoId)?.name ?? 'Repository';
	}

	open(scope: GuidelinesScope): void {
		this.editing = scope;
		if (!this.overview) void this.load();
		if (scope.kind === 'repo') void this.loadRepo(scope.repoId);
	}

	close(): void {
		this.editing = null;
	}

	/** Save the global layer; resolves with the previous text (for Undo). */
	async saveGlobal(content: string): Promise<string> {
		const previous = this.overview?.global.content ?? '';
		const saved = await serverApi.saveGlobalGuidelines(content);
		if (this.overview) this.overview = { ...this.overview, global: saved };
		return previous;
	}

	async propose(repoId: string, content: string): Promise<GuidelinesProposal> {
		const result = await serverApi.proposeRepoGuidelines(repoId, content);
		void this.loadRepo(repoId);
		return result;
	}
}

export const guidelinesStore = new GuidelinesStore();

/** First rule of a guidelines text, for list previews. */
export function firstRule(content: string | null | undefined): string | null {
	for (const line of (content ?? '').split('\n')) {
		const text = line.trim().replace(/^[-*]\s+/, '');
		if (text && !line.trim().startsWith('#') && text !== '-' && text !== 'None.') return text;
	}
	return null;
}
