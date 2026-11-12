import type { PrCheck, PullComment, PullCommit, PullDiff, PullPage } from '@recoder/shared';

import { ApiError, failureText, isOffline, plainly } from '../api/http';
import { whileVisible } from '../review/while-visible';
import { loaded, type Load, type SessionContext } from './session-state';

/** One part of the session that loads on its own: how to read it and write it back. */
interface Part<Value> {
	read: () => Load<Value>;
	write: (load: Load<Value>) => void;
}

/** Running checks are read again this often while the page is visible. */
const CHECKS_MS = 15_000;

/** What the rest of the session hears from the page. */
interface PageEvents {
	/** The page answered: a first load or a refresh. */
	pageLoaded: (page: PullPage) => void;
}

/** True while any check still runs. */
function hasPendingCheck(checks: PrCheck[]): boolean {
	return checks.some((check) => check.state === 'pending' || check.state === 'running');
}

/** A part as `loading` (or `refreshing`, keeping what loaded), then its answer or the failure in plain words. */
async function fill<Value>(part: Part<Value>, fetch: () => Promise<Value>): Promise<void> {
	const before = part.read();

	part.write(before.phase === 'ready' ? { ...before, refreshing: true } : { phase: 'loading' });

	try {
		part.write({ phase: 'ready', value: await fetch(), refreshing: false });
	} catch (error) {
		part.write({ phase: 'failed', error: failureText(error) });
	}
}

/** Reading the page, its diff, commits, checks and conversation, and writing a comment to it. */
export function createPageLoads(context: SessionContext, events: PageEvents) {
	const { client, state, repoId, number } = context;
	const get = state.getState;

	const parts = {
		diff: { read: () => get().diff, write: (diff) => state.setState({ diff }) } satisfies Part<PullDiff>,
		commits: { read: () => get().commits, write: (commits) => state.setState({ commits }) } satisfies Part<
			PullCommit[]
		>,
		checks: { read: () => get().checks, write: (checks) => state.setState({ checks }) } satisfies Part<PrCheck[]>,
		conversation: {
			read: () => get().conversation,
			write: (conversation) => state.setState({ conversation })
		} satisfies Part<PullComment[]>
	};

	/** A failed page read: a 404 is a page that does not exist; a refresh that fails keeps the page it had. */
	function pageFailed(error: unknown): void {
		const { page } = get();
		const offline = isOffline(error);

		if (error instanceof ApiError && error.status === 404) {
			state.setState({ page: { phase: 'not-found', value: null, error: null, offline: false } });

			return;
		}

		if (page.value) {
			state.setState({ page: { ...page, offline } });

			return;
		}

		state.setState({ page: { phase: 'failed', value: null, error: failureText(error), offline } });
	}

	async function loadPage(): Promise<void> {
		try {
			const page = await client.pullPage(repoId, number);

			state.setState({ page: { phase: 'ready', value: page, error: null, offline: false } });
			events.pageLoaded(page);
			followHead(page);
		} catch (error) {
			pageFailed(error);
		}
	}

	/** Reads the diff again when the pull request moved past it, and the checks of the head. */
	function followHead(page: PullPage): void {
		const shown = loaded(get().diff);

		if (shown && shown.headSha !== page.pull.headSha) void loadDiff();
		if (page.capabilities.checks) void loadChecks();
	}

	function loadDiff(): Promise<void> {
		return fill(parts.diff, () => client.pullDiff(repoId, number));
	}

	function loadChecks(): Promise<void> {
		return fill(parts.checks, () => client.pullChecks(repoId, number));
	}

	function checksRunning(): boolean {
		return hasPendingCheck(loaded(get().checks) ?? []);
	}

	return {
		loadPage,
		loadDiff,
		loadChecks,
		loadCommits: () => fill(parts.commits, () => client.pullCommits(repoId, number)),
		loadConversation: () => fill(parts.conversation, () => client.pullComments(repoId, number)),

		/** Reads the checks again while one runs and the page is visible; returns the stop. */
		pollChecks: () => whileVisible(CHECKS_MS, () => void (checksRunning() && loadChecks())),

		/** Posts a comment; it shows in the conversation at once. Rejects with a plain sentence. */
		async postComment(body: string): Promise<void> {
			state.setState({ posting: true });

			try {
				const comment = await plainly(() => client.postPullComment(repoId, number, body));
				const entries = loaded(get().conversation) ?? [];

				state.setState({ conversation: { phase: 'ready', value: [...entries, comment], refreshing: false } });
			} finally {
				state.setState({ posting: false });
			}
		}
	};
}

export type PageLoads = ReturnType<typeof createPageLoads>;
