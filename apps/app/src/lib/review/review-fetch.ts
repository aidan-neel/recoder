import type { FileDiff, PrCheck, PullRequest } from '@recoder/shared';

import { ApiError } from '../api/http';
import { fetchChecks, forgeFailure, readDiff, readPull, type Read, type ReadFailure } from './review-read';
import { isRunning, type ReviewData } from './review-state';
import { syncTab } from './review-tab';
import { sameData } from './same-data';
import { afterVisible } from './while-visible';

/** While the diff has not been computed yet, ask for it this often. */
const FILES_POLL_MS = 4000;

/** A fresh draft's diff arrives once the server has fetched it, so a draft asks this many times, then stops. */
const DRAFT_FILE_POLLS = 6;

/** What the loaders reach in the review store. */
export interface LoadContext {
	get: () => ReviewData;
	set: (partial: Partial<ReviewData>) => void;
	/** The current load's number; it changes on every load and unload. */
	generation: () => number;
	/** True while the page still shows review `id` from load `gen`. */
	current: (id: string, gen: number) => boolean;
	/** Selects the item a link named once the review has it; `final` when no diff is coming to match a file. */
	openLink: (final?: boolean) => void;
}

/** What the fetchers reach in the review store besides what the loaders do. */
interface FetchContext extends LoadContext {
	/** When the copy the page painted from was kept, in ms; 0 on a first visit, or for a copy kept without the time. */
	keptAt: () => number;
}

/** A failed retry rejects, so its button shows the failure face while the notice stays. */
function orThrow(error: ReadFailure | null): void {
	if (error) throw new Error(error.text);
}

/**
 * The review's diff, CI checks and pull request, read beside the review
 * itself. Each keeps its last good copy and says in plain words when a read
 * failed, so the page can offer Try again in place.
 */
export function createFetchers({ get, set, generation, current, openLink, keptAt }: FetchContext) {
	let cancelPoll: (() => void) | null = null;

	/** How many CI checks reads have started; each read takes the next number. */
	let checksStarted = 0;

	/** The last CI checks read taken: its number, its load, and when it answered, in ms. */
	let checksRead = { seq: 0, gen: -1, at: 0 };

	/** The diff read in flight: its load, its place in the poll count, and whether a call came in meanwhile. */
	let filesFlight: { gen: number; polls: number; again: boolean } | null = null;

	/** Takes a diff that says something new; the same diff again keeps the page and its tab as they are. */
	function takeFiles(files: FileDiff[]): void {
		if (!sameData(files, get().files)) {
			set({ files, filesError: null });
			syncTab(get());
		} else if (get().filesError) {
			set({ filesError: null });
		}

		openLink();
	}

	function stopPoll(): void {
		cancelPoll?.();
		cancelPoll = null;
	}

	async function readFiles(gen: number, polls: number): Promise<void> {
		const { id, sample } = get();

		if (sample || !id) return;

		const { value: files, error } = await readDiff(id);

		if (!current(id, gen) || get().status === 'missing') return;

		if (files.length > 0) {
			takeFiles(files);

			return;
		}

		if (error && get().files.length === 0) set({ filesError: error });

		const { review } = get();

		if (isRunning(review) || (review?.status === 'draft' && polls < DRAFT_FILE_POLLS)) {
			cancelPoll = afterVisible(FILES_POLL_MS, () => generation() === gen && loadFiles(polls + 1));
		} else {
			openLink(true);
		}
	}

	/**
	 * Reads the diff, one request at a time: a call while one is in flight
	 * runs once more after it answers, at the same place in the poll count, so
	 * calls that overlap never start a draft's count over. A running review
	 * asks again until the diff lands, and a fresh draft a few times while the
	 * server fetches it; a hidden page waits until it shows again.
	 */
	function loadFiles(polls = 0): void {
		const gen = generation();

		if (filesFlight?.gen === gen) {
			filesFlight.again = true;

			return;
		}

		const flight = { gen, polls, again: false };

		filesFlight = flight;
		stopPoll();

		void readFiles(gen, polls).finally(() => {
			if (filesFlight !== flight) return;

			filesFlight = null;

			if (flight.again) loadFiles(flight.polls);
		});
	}

	/**
	 * A failed read of the CI checks. With none on screen it says why, unless
	 * the pull request's lookup has yet to answer: the checks' place is then
	 * held until it does ({@link settlePull}), since that line may speak for
	 * the checks too. Checks on screen stay, marked as not refreshed since
	 * they were read (by this load, else with the copy the page painted from),
	 * until a read answers.
	 */
	function checksFailed(failure: ReadFailure | null, gen: number): void {
		const { checks, checksStale, pullAnswered } = get();

		if (!checks?.length) {
			set(pullAnswered ? { checks: [], checksError: failure } : { checksError: failure });
		} else if (failure && !sameData(failure, checksStale?.failure)) {
			const since = checksStale?.since ?? (checksRead.gen === gen ? checksRead.at : keptAt());

			set({ checksStale: { since, failure } });
		}
	}

	/**
	 * CI checks. A review with no forge behind it has no checks, and the
	 * server's 409 for one is not a failure. The first load starts this
	 * before the review is in, so the checks can paint with the page; until
	 * the review is in, nothing marks it a stub. A failure is handled by
	 * {@link checksFailed}; an answer clears it. Reads overlap (the first
	 * load, a change of status, a running check's poll), so each answer
	 * counts only when no read started after it has answered already: a late
	 * answer never puts older checks back, nor marks newer ones as not
	 * refreshed.
	 */
	async function readChecks(): Promise<ReadFailure | null> {
		const { id, review } = get();
		const gen = generation();
		const seq = ++checksStarted;

		if (review?.source === 'stub') {
			if (!get().checks) set({ checks: [] });

			return null;
		}

		try {
			const checks = await fetchChecks(id);

			if (!current(id, gen) || seq < checksRead.seq) return null;

			checksRead = { seq, gen, at: Date.now() };

			if (!sameData(checks, get().checks)) set({ checks, checksError: null, checksStale: null });
			else if (get().checksError || get().checksStale) set({ checksError: null, checksStale: null });

			return null;
		} catch (error) {
			if (!current(id, gen) || seq < checksRead.seq) return null;

			const notStub = !(error instanceof ApiError && error.status === 409);
			const failure = notStub ? forgeFailure(error, get().review) : null;

			checksFailed(failure, gen);

			return failure;
		}
	}

	/**
	 * What the pull request's first answer settles besides itself: a checks
	 * failure that waited for it gives up the checks' held place.
	 */
	function firstAnswer(): Partial<ReviewData> {
		if (get().pullAnswered) return {};

		return get().checks === null && get().checksError ? { pullAnswered: true, checks: [] } : { pullAnswered: true };
	}

	/** Takes a pull request lookup's answer once it lands, unless the page moved on. */
	async function settlePull(pending: Promise<Read<PullRequest | null>>, id: string, gen: number): Promise<void> {
		const { value: pull, error } = await pending;

		if (!current(id, gen)) return;

		const answered = firstAnswer();

		if (pull && !sameData(pull, get().pull)) set({ ...answered, pull, pullError: null });
		else if (pull && get().pullError) set({ ...answered, pullError: null });
		else if (!pull && !get().pull && !sameData(error, get().pullError)) set({ ...answered, pullError: error });
		else if (!get().pullAnswered) set(answered);

		syncTab(get());
	}

	return {
		loadFiles,

		/** Reads the diff once a poll's wait has passed, when a read just said it is not there yet. */
		pollFiles(): void {
			const gen = generation();

			stopPoll();
			cancelPoll = afterVisible(FILES_POLL_MS, () => generation() === gen && loadFiles(1));
		},

		/** Reads the diff once more after a failure; rejects while it still fails. */
		async retryFiles(): Promise<void> {
			const { id } = get();
			const gen = generation();
			const { value: files, error } = await readDiff(id);

			if (!current(id, gen)) return;

			if (files.length > 0) takeFiles(files);
			else set({ filesError: error });

			orThrow(error);
		},

		/** Reads the CI checks; resolves with why they failed, or null. */
		loadChecks: readChecks,

		async retryChecks(): Promise<void> {
			orThrow(await readChecks());
		},

		/** True while any CI check has yet to finish. */
		checksRunning(): boolean {
			return !!get().checks?.some((check: PrCheck) => check.state === 'running' || check.state === 'pending');
		},

		settlePull,

		/** Reads the pull request again, so commits pushed while the page is open raise the outdated notice. */
		refreshPull(): void {
			const { review, id } = get();

			if (review) void settlePull(readPull(review), id, generation());
		},

		/** Looks the pull request up once more after a failure; rejects while it still fails. */
		async retryPull(): Promise<void> {
			const { review, id } = get();

			if (!review) return;

			const pending = readPull(review);

			await settlePull(pending, id, generation());
			orThrow((await pending).error);
		},

		/** Stops the diff's polling, when the page leaves or the review is gone. */
		stop(): void {
			stopPoll();
			filesFlight = null;
		}
	};
}
