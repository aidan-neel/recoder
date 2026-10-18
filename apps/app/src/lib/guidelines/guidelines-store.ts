import type { GlobalGuidelines, GuidelinesOverview, GuidelinesProposal, RepoGuidelines } from '@recoder/shared';
import { create } from 'zustand';

import { guidelinesApi } from '../api/guidelines';
import { failureText, isOffline } from '../api/http';
import { useGuidelinesEditor } from './editor-store';

/** `offline`: the review server never answered. `failed`: it answered the first load with an error. */
type OverviewStatus = 'loading' | 'ready' | 'offline' | 'failed';

/** One repository's `.recoder/REVIEW.md`, read through its forge. */
type RepoState = { status: 'loading' } | { status: 'ready'; data: RepoGuidelines } | { status: 'error'; error: string };

interface GuidelinesStore {
	status: OverviewStatus;
	overview: GuidelinesOverview | null;
	/** Why the first load failed, as the server put it. */
	error: string | null;
	repos: Record<string, RepoState>;
	/**
	 * Loads the overview, then every tracked repository's file. A reload keeps
	 * what is on screen, and a retry after a failure keeps the notice up until
	 * the answer lands.
	 */
	load: () => Promise<void>;
	/** Reads one repository's file. A reload or a retry keeps what is on screen until the answer lands. */
	loadRepo: (repoId: string) => Promise<void>;
	/** Saves the global layer and resolves with the layer it replaced, for Undo. */
	saveGlobal: (content: string) => Promise<GlobalGuidelines>;
	/**
	 * Puts back a layer `saveGlobal` replaced. A layer never saved goes back to
	 * not set, so Recoder's defaults apply again rather than a saved copy of them.
	 */
	restoreGlobal: (previous: GlobalGuidelines) => Promise<void>;
	/** Opens or updates the pull request for a repository's file, then reads the file again. */
	propose: (repoId: string, content: string) => Promise<GuidelinesProposal>;
}

/** Closes an open repository editor once its repository is no longer tracked. */
function closeUntracked(overview: GuidelinesOverview): void {
	const editor = useGuidelinesEditor.getState();
	const open = editor.open;

	if (open?.startsWith('repo:') && !overview.repos.some((repo) => open === `repo:${repo.id}`)) editor.close();
}

/** What reviewers follow, as Settings → Guidelines shows it. */
export const useGuidelines = create<GuidelinesStore>((set, get) => {
	/** The latest read per repository; an older answer that lands late is dropped. */
	const latest = new Map<string, number>();
	let inflight: Promise<void> | null = null;

	function setGlobal(global: GlobalGuidelines): void {
		const overview = get().overview;

		if (overview) set({ overview: { ...overview, global } });
	}

	async function loadOverview(): Promise<void> {
		try {
			const overview = await guidelinesApi.overview();

			set({ status: 'ready', overview, error: null });
			closeUntracked(overview);

			await Promise.all(overview.repos.map((repo) => get().loadRepo(repo.id)));
		} catch (error) {
			if (get().overview) return;

			set({ status: isOffline(error) ? 'offline' : 'failed', error: failureText(error, 'Guidelines didn’t load.') });
		}
	}

	return {
		status: 'loading',
		overview: null,
		error: null,
		repos: {},

		load() {
			inflight ??= loadOverview().finally(() => {
				inflight = null;
			});

			return inflight;
		},

		async loadRepo(repoId) {
			const ticket = (latest.get(repoId) ?? 0) + 1;

			latest.set(repoId, ticket);

			if (!get().repos[repoId]) set({ repos: { ...get().repos, [repoId]: { status: 'loading' } } });

			let next: RepoState;

			try {
				next = { status: 'ready', data: await guidelinesApi.repo(repoId) };
			} catch (error) {
				next = { status: 'error', error: failureText(error, 'Couldn’t read the repository.') };
			}

			if (latest.get(repoId) === ticket) set({ repos: { ...get().repos, [repoId]: next } });
		},

		async saveGlobal(content) {
			const previous = get().overview?.global ?? { content: '', updatedAt: null };

			setGlobal(await guidelinesApi.saveGlobal(content));

			return previous;
		},

		async restoreGlobal(previous) {
			setGlobal(
				previous.updatedAt === null
					? await guidelinesApi.resetGlobal()
					: await guidelinesApi.saveGlobal(previous.content)
			);
		},

		async propose(repoId, content) {
			const proposal = await guidelinesApi.propose(repoId, content);

			void get().loadRepo(repoId);

			return proposal;
		}
	};
});
