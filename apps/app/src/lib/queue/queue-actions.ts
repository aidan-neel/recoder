import type { ProgressSummaries, Review } from '@recoder/shared';

import { ApiError, failureText, plainly } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { SAMPLE_REVIEW } from '../sample/sample-review';
import { errorToast, undoToast } from '../shell/notify';
import { reviewHref } from '../shell/routes';
import { useShell } from '../shell/shell-store';
import { queueEntry, type QueueEntry } from './queue';
import { entryRepo } from './queue-rows';

/** The part of the queue store the row actions read and change. */
interface RowState {
	entries: QueueEntry[];
	progress: ProgressSummaries;
	sample: boolean;
	/** Rows whose start request is in flight, by entry key. */
	starting: Record<string, boolean>;
}

/** What the row actions need from the store's loading. */
interface QueueLoad {
	get: () => RowState;
	set: (change: Partial<RowState>) => void;
	/** Marks a change made here, so a refresh already in flight does not undo it. */
	touch: () => void;
	/** Plans the next refresh: soon, now that a review runs. */
	schedule: () => void;
	/** Loads the list again. */
	refresh: () => Promise<boolean>;
	/** Bumps on every load and unmount, so a sample run from an earlier visit stops ticking. */
	generation: () => number;
}

/** A started sample review finishes one step per tick. */
const SAMPLE_TICK_MS = 900;

/** Steps a started sample review takes. */
const SAMPLE_STEPS = 7;

/** The request that reviews a row: resume a failed review, run a draft session, or queue a fresh review. */
function startRequest(entry: QueueEntry): Promise<Review> {
	if (entry.state === 'failed' && entry.review) return reviewsApi.continue(entry.review.id);
	if (entry.review?.status === 'draft') return reviewsApi.startDraft(entry.review.id);

	return reviewsApi.start(entry.repoId, entry.pull);
}

/** Toasts a failed request with the server's reason and any way out it offered. */
function failed(title: string, error: unknown): void {
	const action = error instanceof ApiError ? error.action : undefined;

	errorToast(title, failureText(error), action);
}

/**
 * The queue's row actions: start a review (or walk the sample through one),
 * open a draft conversation, and delete a review. Each row's button spins
 * while its request runs, and a failure toasts the server's reason.
 */
export function queueActions({ get, set, touch, schedule, refresh, generation }: QueueLoad) {
	function replace(key: string, change: (entry: QueueEntry) => QueueEntry): void {
		set({ entries: get().entries.map((entry) => (entry.key === key ? change(entry) : entry)) });
	}

	/** A sample review that walks through its steps and lands as ready to merge. */
	function runSample(entry: QueueEntry): void {
		const id = `sample-${entry.pull.number}`;
		const gen = generation();
		let done = 0;

		const running: Review = {
			...SAMPLE_REVIEW,
			id,
			prNumber: entry.pull.number,
			headSha: entry.pull.headSha,
			status: 'running',
			findings: [],
			questions: undefined
		};

		replace(entry.key, (item) => queueEntry(entryRepo(item), item.pull, running, {}));

		const tick = () => {
			if (generation() !== gen) return;

			done += 1;
			set({ progress: { ...get().progress, [id]: { tasksDone: done, tasksTotal: SAMPLE_STEPS, agents: 1 } } });

			if (done < SAMPLE_STEPS) return void setTimeout(tick, SAMPLE_TICK_MS);

			replace(entry.key, (item) => queueEntry(entryRepo(item), item.pull, { ...running, status: 'passed' }, {}));
		};

		setTimeout(tick, SAMPLE_TICK_MS);
	}

	/** Runs a row's request with the row marked as starting, so its button spins until the server answers. */
	async function pending(entry: QueueEntry, failure: string, work: () => Promise<void>): Promise<void> {
		set({ starting: { ...get().starting, [entry.key]: true } });

		try {
			await work();
		} catch (error) {
			failed(failure, error);
		} finally {
			const { [entry.key]: _done, ...rest } = get().starting;

			set({ starting: rest });
		}
	}

	/** Puts a review the server just made on its row, ahead of any refresh already in flight. */
	function land(entry: QueueEntry, review: Review): void {
		touch();
		replace(entry.key, (item) => queueEntry(entryRepo(item), item.pull, review, {}));
	}

	/** Reviews the pull request: resumes a failed review, runs a draft, else queues a fresh review of the current head. */
	async function start(entry: QueueEntry): Promise<void> {
		const current = get().entries.find((item) => item.key === entry.key) ?? entry;

		if (get().starting[current.key] || current.state === 'reviewing') return;

		if (get().sample) return runSample(current);

		await pending(current, 'Couldn’t start the review', async () => {
			land(current, await startRequest(current));
			schedule();
		});
	}

	/** Opens a draft session for a pull request with no review, so the person can talk it through before one runs. */
	async function talk(entry: QueueEntry): Promise<void> {
		const current = get().entries.find((item) => item.key === entry.key) ?? entry;

		if (get().sample || get().starting[current.key] || current.review) return;

		await pending(current, 'Couldn’t start the conversation', async () => {
			const review = await reviewsApi.draft(current.repoId, current.pull);

			land(current, review);
			useShell.getState().navigate(reviewHref(review.id));
		});
	}

	/** Deletes a review and reloads the list. Rejects with what went wrong, for the dialog to show. */
	async function remove(id: string): Promise<void> {
		await plainly(() => reviewsApi.remove(id));

		touch();

		set({
			entries: get().entries.map((entry) =>
				entry.review?.id === id ? queueEntry(entryRepo(entry), entry.pull, null, {}) : entry
			)
		});

		undoToast('Review deleted');
		void refresh();
	}

	return { start, talk, remove };
}
