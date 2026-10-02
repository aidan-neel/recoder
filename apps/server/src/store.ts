import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import {
	settleAssignments,
	type CommandRun,
	type Repo,
	type Review,
	type ReviewProgress,
	type TokenCall
} from '@recoder/shared';
import { serverDataDir } from './util/data-dir';
import type { ReviewCheckpoint } from './review/session/review-checkpoint';

/**
 * SQLite-backed store. Everything the UI treats as durable (repos, reviews,
 * runs, diffs) survives restarts and `--hot` reloads — previously all of
 * this lived in Maps and vanished on every server edit.
 */

let handle: Database | null = null;

function getDb(): Database {
	if (!handle) {
		handle = new Database(join(serverDataDir(), 'recoder.db'));
		handle.run('PRAGMA journal_mode = WAL');
		handle.run('CREATE TABLE IF NOT EXISTS repos (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
		handle.run('CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
		handle.run('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
		handle.run('CREATE TABLE IF NOT EXISTS review_progress (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
		handle.run('CREATE TABLE IF NOT EXISTS review_metrics (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
		handle.run('CREATE TABLE IF NOT EXISTS review_checkpoints (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
		handle.run('CREATE TABLE IF NOT EXISTS review_diffs (review_id TEXT PRIMARY KEY, diff TEXT NOT NULL)');
	}

	return handle;
}

/** Test helper: close + forget the handle (e.g. after switching data dirs). */
export function closeStore(): void {
	flushReviewProgress();
	progressCache.clear();
	progressDirty.clear();
	handle?.close();
	handle = null;
}

function createCollection<T extends { id: string }>(table: string) {
	const database = () => getDb();

	return {
		list: (): T[] =>
			(database().query(`SELECT value FROM ${table} ORDER BY rowid`).all() as { value: string }[]).map(
				(row) => JSON.parse(row.value) as T
			),
		get: (id: string): T | undefined => {
			const row = database().query(`SELECT value FROM ${table} WHERE id = ?`).get(id) as {
				value: string;
			} | null;

			return row ? (JSON.parse(row.value) as T) : undefined;
		},
		set: (item: T): T => {
			database()
				.query(`INSERT INTO ${table} (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`)
				.run(item.id, JSON.stringify(item));

			return item;
		},
		delete: (id: string): boolean => database().query(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0,
		clear: (): void => {
			database().query(`DELETE FROM ${table}`).run();
		}
	};
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
export function flushReviewProgress(): void {
	if (progressTimer) {
		clearTimeout(progressTimer);
		progressTimer = null;
	}

	let failure: unknown;

	for (const id of [...progressDirty]) {
		try {
			const snapshot = progressCache.get(id);

			if (snapshot) progressTable.set(snapshot);
			progressDirty.delete(id);
		} catch (error) {
			failure ??= error;
		}
	}

	if (failure !== undefined) throw failure;
}

/** The write-behind timer. A throw here would crash the server, so log it and try again later. */
function flushOnTimer(): void {
	try {
		flushReviewProgress();
	} catch (error) {
		console.error('[store] failed to flush review progress', error);
		progressTimer ??= setTimeout(flushOnTimer, PROGRESS_FLUSH_MS);
	}
}

/**
 * Live review progress. A running review updates its snapshot many times a
 * second (streamed reasoning and replies from every specialist), and each
 * snapshot is a large JSON blob: serializing it to SQLite on every event
 * stalled the server. Reads and writes go through memory; SQLite gets the
 * latest snapshot shortly after, on a terminal event, and at exit.
 */
export const reviewProgress = {
	list: (): ReviewProgress[] => {
		flushReviewProgress();

		return progressTable.list().map((item) => progressCache.get(item.id) ?? item);
	},
	get: (id: string): ReviewProgress | undefined => {
		const cached = progressCache.get(id);

		if (cached) {
			// Most recently used last.
			progressCache.delete(id);
			progressCache.set(id, cached);

			return cached;
		}

		const stored = progressTable.get(id);

		if (stored) remember(stored);

		return stored;
	},
	set: (item: ReviewProgress): ReviewProgress => {
		remember(item);
		progressDirty.add(item.id);
		progressTimer ??= setTimeout(flushOnTimer, PROGRESS_FLUSH_MS);

		return item;
	},
	delete: (id: string): boolean => {
		progressCache.delete(id);
		progressDirty.delete(id);

		return progressTable.delete(id);
	},
	clear: (): void => {
		progressCache.clear();
		progressDirty.clear();
		progressTable.clear();
	},
	flush: flushReviewProgress
};

function remember(item: ReviewProgress): void {
	progressCache.delete(item.id);
	progressCache.set(item.id, item);

	while (progressCache.size > PROGRESS_CACHE_SIZE) {
		const oldest = progressCache.keys().next().value as string;

		if (progressDirty.has(oldest)) {
			progressTable.set(progressCache.get(oldest)!);
			progressDirty.delete(oldest);
		}

		progressCache.delete(oldest);
	}
}

// Nothing in memory may be lost on the way out: flush on exit and on the signals that end a dev
// server. Registered once per process; `--hot` re-evaluates this module and must not stack listeners.
const hooks = globalThis as { __recoderProgressFlush?: () => void };
const registered = hooks.__recoderProgressFlush !== undefined;

// The handlers call whichever module instance is current, so a reload's cache is the one flushed.
hooks.__recoderProgressFlush = flushReviewProgress;

if (!registered) {
	process.on('exit', () => hooks.__recoderProgressFlush?.());

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			hooks.__recoderProgressFlush?.();
			process.exit(signal === 'SIGINT' ? 130 : 143);
		});
	}
}

export const reviewMetrics = createCollection<{
	id: string;
	startedAt: string;
	pipelineTracked: boolean;
	calls: TokenCall[];
}>('review_metrics');

/** Where an unfinished review stopped, so it can continue instead of starting over (see ReviewCheckpoint). */
export const reviewCheckpoints = createCollection<ReviewCheckpoint>('review_checkpoints');

/** Sandbox checkout paths by review id. In memory only; `lib/review-checkout.ts` finds or restores a checkout after a restart. */
export const reviewSandboxes = new Map<string, string>();

/** Raw unified diffs by review id. Populated by the pipeline's fetch step. */
export const reviewDiffs = {
	get: (reviewId: string): string | undefined => {
		const row = getDb().query('SELECT diff FROM review_diffs WHERE review_id = ?').get(reviewId) as {
			diff: string;
		} | null;

		return row?.diff;
	},
	has: (reviewId: string): boolean => reviewDiffs.get(reviewId) !== undefined,
	set: (reviewId: string, diff: string): void => {
		getDb()
			.query(
				'INSERT INTO review_diffs (review_id, diff) VALUES (?, ?) ON CONFLICT(review_id) DO UPDATE SET diff = excluded.diff'
			)
			.run(reviewId, diff);
	},
	delete: (reviewId: string): void => {
		getDb().query('DELETE FROM review_diffs WHERE review_id = ?').run(reviewId);
	}
};

/**
 * When the pipeline ends, nothing it started is still writing: settle its
 * half-streamed replies and reasoning (dropping empty ones) so the page stops
 * showing "Thinking" and a Stop button. Discussion replies have their own lifecycle.
 */
export function settlePipelineStreams(reviewId: string): ReviewProgress | null {
	const progress = reviewProgress.get(reviewId);

	if (!progress) return null;

	const open = (status?: string) => status === 'streaming';

	if (
		!progress.messages?.some((m) => open(m.status) && !m.discussion) &&
		!progress.reasoning?.some((r) => open(r.status))
	)
		return null;

	const settled: ReviewProgress = {
		...progress,
		messages: progress.messages
			?.filter((m) => !(open(m.status) && !m.discussion && !m.text.trim()))
			.map((m) => (open(m.status) && !m.discussion ? { ...m, status: 'done' as const } : m)),
		reasoning: progress.reasoning
			?.filter((r) => !(open(r.status) && !r.text.trim()))
			.map((r) => (open(r.status) ? { ...r, status: 'done' as const } : r))
	};

	reviewProgress.set(settled);

	return settled;
}

/**
 * Mark reviews left running/queued by a previous process as failed so the UI
 * never spins forever on orphaned work.
 */
export function recoverStaleReviews(): number {
	let recovered = 0;

	for (const review of db.reviews.list()) {
		if (review.status === 'running' || review.status === 'queued') {
			db.reviews.set({
				...review,
				status: 'failed',
				summary: 'The server restarted mid-review. Progress so far was kept.',
				updatedAt: new Date().toISOString()
			});

			const progress = reviewProgress.get(review.id);

			if (progress) {
				reviewProgress.set({
					...progress,
					outcome: 'failed',
					assignments: settleAssignments(progress.assignments ?? [], 'Stopped by a server restart'),
					updatedAt: new Date().toISOString()
				});
			}

			recovered++;
		}

		const progress = reviewProgress.get(review.id);

		if (
			progress?.messages?.some((message) => message.status === 'streaming') ||
			progress?.reasoning?.some((entry) => entry.status === 'streaming')
		) {
			reviewProgress.set({
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
