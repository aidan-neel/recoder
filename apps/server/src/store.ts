import { settleAssignments, type CommandRun, type Repo, type Review, type ReviewProgress } from '@recoder/shared';
import { sqlite as getDb, sqliteCollection as createCollection, closeSqlite } from './storage/sqlite';
import { progressWrites, metricWrites } from './storage/persistence-queue';
import type { ReviewCheckpoint } from './review/session/review-checkpoint';
import type { PipelineRun, RunTokenCall } from './models/metrics';
import { settleTasks } from './review/session/task-state';

async function flushPersistence(): Promise<void> {
	await progressWrites.drainAll();
	await metricWrites.drainAll();
	await flushReviewProgress();
}

export async function closeStore(): Promise<void> {
	await flushPersistence();
	progressCache.clear();
	progressDirty.clear();
	await closeSqlite();
}
export const db = {
	repos: createCollection<Repo>('repos'),
	reviews: createCollection<Review>('reviews'),
	runs: createCollection<CommandRun>('runs')
};

const progressTable = createCollection<ReviewProgress>('review_progress');
const progressCache = new Map<string, ReviewProgress>();
const progressDirty = new Set<string>();
let progressTimer: ReturnType<typeof setTimeout> | null = null;
/** Snapshots kept in memory; the oldest untouched one is written out and dropped past this. */
const PROGRESS_CACHE_SIZE = 24;
/** How long a snapshot may sit in memory before it reaches SQLite. */
const PROGRESS_FLUSH_MS = 750;

/**
 * Write every pending snapshot to SQLite now. A snapshot stays pending until
 * its own write succeeds, and one failed write doesn't hold back the rest.
 */
async function flushReviewProgress(): Promise<void> {
	if (progressTimer) {
		clearTimeout(progressTimer);
		progressTimer = null;
	}

	let failure: unknown;

	for (const id of [...progressDirty]) {
		try {
			const snapshot = progressCache.get(id);

			if (snapshot) await progressTable.set(snapshot);
			progressDirty.delete(id);
		} catch (error) {
			failure ??= error;
		}
	}

	if (failure !== undefined) throw failure;
}

/** The write-behind timer. A throw here would crash the server, so log it and try again later. */
async function flushOnTimer(): Promise<void> {
	try {
		await flushReviewProgress();
	} catch (error) {
		console.error('[store] failed to flush review progress', error);
		progressTimer ??= setTimeout(flushOnTimer, PROGRESS_FLUSH_MS);
	}
}

/**
 * Live review progress. A running review updates its snapshot many times a
 * second (streamed reasoning and replies from every reviewer), and each
 * snapshot is a large JSON blob: serializing it to SQLite on every event
 * stalled the server. Reads and writes go through memory; SQLite gets the
 * latest snapshot shortly after, on a terminal event, and at exit.
 */
export const reviewProgress = {
	list: async (): Promise<ReviewProgress[]> => {
		await progressWrites.drainAll();
		await flushReviewProgress();

		return (await progressTable.list()).map((item) => progressCache.get(item.id) ?? item);
	},
	get: async (id: string): Promise<ReviewProgress | undefined> => {
		await progressWrites.drain(id);

		const cached = progressCache.get(id);

		if (cached) {
			progressCache.delete(id);
			progressCache.set(id, cached);

			return cached;
		}

		const stored = await progressTable.get(id);

		if (stored) await remember(stored);

		return stored;
	},
	set: async (item: ReviewProgress): Promise<ReviewProgress> => {
		await progressWrites.drain(item.id);
		await remember(item);
		progressDirty.add(item.id);
		progressTimer ??= setTimeout(flushOnTimer, PROGRESS_FLUSH_MS);

		return item;
	},
	delete: async (id: string): Promise<boolean> => {
		await progressWrites.drain(id);
		progressCache.delete(id);
		progressDirty.delete(id);

		return await progressTable.delete(id);
	},
	clear: async (): Promise<void> => {
		await progressWrites.drainAll();
		progressCache.clear();
		progressDirty.clear();
		await progressTable.clear();
	},
	update: async (id: string, mutate: (current: ReviewProgress | undefined) => ReviewProgress | undefined) => {
		const pending = progressCache.get(id);

		if (progressDirty.has(id) && pending) {
			await progressTable.set(pending);
			progressDirty.delete(id);
		}

		const next = await progressTable.update(id, mutate);

		if (next) await remember(next);
		else progressCache.delete(id);

		return next;
	},
	flush: flushReviewProgress
};

/** Cache a snapshot as the most recently used (the map's last entry), writing out and dropping the oldest past the cap. */
async function remember(item: ReviewProgress): Promise<void> {
	progressCache.delete(item.id);
	progressCache.set(item.id, item);

	while (progressCache.size > PROGRESS_CACHE_SIZE) {
		const oldest = progressCache.keys().next().value as string;

		if (progressDirty.has(oldest)) {
			await progressTable.set(progressCache.get(oldest)!);
			progressDirty.delete(oldest);
		}

		progressCache.delete(oldest);
	}
}

/** What the shutdown hooks keep on `globalThis`, so a `--hot` reload finds the registrations of the one before. */
interface ShutdownHooks {
	__recoderProgressFlush?: () => Promise<void>;
	__recoderSignalExit?: boolean;
}

/**
 * Drain queued persistence on natural process shutdown. The listener is registered once per
 * process, since `--hot` re-evaluates this module and must not stack them, and it calls whichever module instance
 * is current, so a reload's cache is the one flushed.
 */
function flushOnShutdown(): void {
	const hooks = globalThis as ShutdownHooks;
	const registered = hooks.__recoderProgressFlush !== undefined;

	hooks.__recoderProgressFlush = flushPersistence;
	if (registered) return;

	process.on('beforeExit', async () => {
		await hooks.__recoderProgressFlush?.();
	});
}

flushOnShutdown();

/**
 * Ends the process with the signal's usual code (130 for SIGINT, 143 for SIGTERM) after flushing, as a dev server
 * should. Only the server's boot calls it: a program that merely imports this module, like the command line, owns
 * its signals. Once per process, since `--hot` re-runs the boot.
 */
export function exitOnShutdownSignals(): void {
	const hooks = globalThis as ShutdownHooks;

	if (hooks.__recoderSignalExit) return;
	hooks.__recoderSignalExit = true;

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, async () => {
			await hooks.__recoderProgressFlush?.();
			process.exit(signal === 'SIGINT' ? 130 : 143);
		});
	}
}

const metricsTable = createCollection<{
	id: string;
	startedAt: string;
	pipelineTracked: boolean;
	calls: RunTokenCall[];
	runs?: PipelineRun[];
}>('review_metrics');

export const reviewMetrics = {
	...metricsTable,
	get: async (id: string) => {
		await metricWrites.drain(id);

		return metricsTable.get(id);
	},
	list: async () => {
		await metricWrites.drainAll();

		return metricsTable.list();
	},
	delete: async (id: string) => {
		await metricWrites.drain(id);

		return metricsTable.delete(id);
	},
	clear: async () => {
		await metricWrites.drainAll();

		return metricsTable.clear();
	}
};
/** Where an unfinished review stopped, so it can continue instead of starting over (see ReviewCheckpoint). */
export const reviewCheckpoints = createCollection<ReviewCheckpoint>('review_checkpoints');
/** A passed review's last checkpoint, kept so the review can be replayed from verification without its reviewers. */
export const reviewReplays = createCollection<ReviewCheckpoint>('review_replays');

/** Kept checkpoints are dropped oldest first once together they pass this size; `RECODER_REPLAY_BYTES` overrides it. */
const REPLAY_BYTES = 512 * 1024 * 1024;

/**
 * Drops the oldest kept checkpoints until the rest fit in `maxBytes`, and never
 * `keepId`, the one just kept. A dropped review can no longer be replayed.
 */
export async function evictReplays(maxBytes: number, keepId?: string): Promise<void> {
	const rows = getDb().query('SELECT id, length(value) AS bytes FROM review_replays ORDER BY rowid').all() as {
		id: string;
		bytes: number;
	}[];

	let total = rows.reduce((sum, row) => sum + row.bytes, 0);

	for (const row of rows) {
		if (total <= maxBytes) break;
		if (row.id === keepId) continue;
		await reviewReplays.delete(row.id);
		total -= row.bytes;
	}
}
/** A passed review never resumes, so its checkpoint moves to the replays, newest last, and old ones are evicted by size. */
export async function keepForReplay(reviewId: string): Promise<void> {
	const final = await reviewCheckpoints.get(reviewId);

	if (final) {
		await reviewReplays.delete(reviewId);
		await reviewReplays.set(final);
		await evictReplays(Number(process.env.RECODER_REPLAY_BYTES) || REPLAY_BYTES, reviewId);
	}

	await reviewCheckpoints.delete(reviewId);
}
/** Sandbox checkout paths by review id. In memory only; `lib/review-checkout.ts` finds or restores a checkout after a restart. */
export const reviewSandboxes = new Map<string, string>();
/** Raw unified diffs by review id. Populated by the pipeline's fetch step. */
export const reviewDiffs = {
	get: async (reviewId: string): Promise<string | undefined> => {
		const row = getDb().query('SELECT diff FROM review_diffs WHERE review_id = ?').get(reviewId) as {
			diff: string;
		} | null;

		return row?.diff;
	},
	has: async (reviewId: string): Promise<boolean> => (await reviewDiffs.get(reviewId)) !== undefined,
	set: async (reviewId: string, diff: string): Promise<void> => {
		getDb()
			.query(
				'INSERT INTO review_diffs (review_id, diff) VALUES (?, ?) ON CONFLICT(review_id) DO UPDATE SET diff = excluded.diff'
			)
			.run(reviewId, diff);
	},
	delete: async (reviewId: string): Promise<void> => {
		getDb().query('DELETE FROM review_diffs WHERE review_id = ?').run(reviewId);
	}
};
/**
 * When the pipeline ends, nothing it started is still writing: settle its
 * half-streamed replies and reasoning (dropping empty ones) so the page stops
 * showing "Thinking" and a Stop button. Discussion replies have their own lifecycle.
 */
export async function settlePipelineStreams(reviewId: string): Promise<ReviewProgress | null> {
	await progressWrites.drain(reviewId);

	let settled: ReviewProgress | null = null;
	const open = (status?: string) => status === 'streaming';

	await reviewProgress.update(reviewId, (progress) => {
		if (!progress) return undefined;
		if (
			!progress.messages?.some((message) => open(message.status) && !message.discussion) &&
			!progress.reasoning?.some((reasoning) => open(reasoning.status))
		)
			return progress;

		settled = {
			...progress,
			messages: progress.messages
				?.filter((message) => !(open(message.status) && !message.discussion && !message.text.trim()))
				.map((message) =>
					open(message.status) && !message.discussion ? { ...message, status: 'done' as const } : message
				),
			reasoning: progress.reasoning
				?.filter((reasoning) => !(open(reasoning.status) && !reasoning.text.trim()))
				.map((reasoning) => (open(reasoning.status) ? { ...reasoning, status: 'done' as const } : reasoning))
		};

		return settled;
	});

	return settled;
}

/** Why a review's open work was closed when the server came back up. */
const RESTARTED = 'Stopped by a server restart';

/**
 * Mark reviews left running/queued by a previous process as failed, with
 * their reviewers and tasks closed out, so the UI never spins forever on
 * orphaned work.
 */
export async function recoverStaleReviews(): Promise<number> {
	let recovered = 0;

	for (const review of await db.reviews.list()) {
		if (review.status === 'running' || review.status === 'queued') {
			await db.reviews.set({
				...review,
				status: 'failed',
				summary: 'The server restarted mid-review. Progress so far was kept.',
				updatedAt: new Date().toISOString()
			});

			const progress = await reviewProgress.get(review.id);

			if (progress) {
				const settled = settleTasks(Object.values(progress.tasks), RESTARTED);

				await reviewProgress.set({
					...progress,
					outcome: 'failed',
					assignments: settleAssignments(progress.assignments ?? [], RESTARTED),
					tasks: { ...progress.tasks, ...Object.fromEntries(settled.map((task) => [task.id, task])) },
					updatedAt: new Date().toISOString()
				});
			}

			recovered++;
		}

		const progress = await reviewProgress.get(review.id);

		if (
			progress?.messages?.some((message) => message.status === 'streaming') ||
			progress?.reasoning?.some((entry) => entry.status === 'streaming')
		) {
			await reviewProgress.set({
				...progress,
				messages: progress.messages?.map((message) =>
					message.status === 'streaming'
						? {
								...message,
								status: 'error',
								text: `${message.text}${message.text ? '\n\n' : ''}Interrupted by a server restart.`
							}
						: message
				),
				reasoning: progress.reasoning?.map((entry) =>
					entry.status === 'streaming' ? { ...entry, status: 'error' } : entry
				)
			});
		}
	}

	if (recovered > 0) console.warn(`[store] marked ${recovered} stale review(s) as failed`);

	return recovered;
}
