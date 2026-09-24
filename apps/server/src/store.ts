import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import type { CommandRun, Repo, Review, ReviewProgress, TokenCall } from '@recoder/shared';
import { serverDataDir } from './lib/data-dir';

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
		handle.run(
			'CREATE TABLE IF NOT EXISTS review_diffs (review_id TEXT PRIMARY KEY, diff TEXT NOT NULL)'
		);
	}
	return handle;
}

/** Test helper: close + forget the handle (e.g. after switching data dirs). */
export function closeStore(): void {
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
		delete: (id: string): boolean =>
			database().query(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0,
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

export const reviewProgress = createCollection<ReviewProgress>('review_progress');

export const reviewMetrics = createCollection<{
	id: string;
	startedAt: string;
	pipelineTracked: boolean;
	calls: TokenCall[];
}>('review_metrics');

/** Sandbox checkout paths by review id. In memory only; `lib/review-checkout.ts` finds or restores a checkout after a restart. */
export const reviewSandboxes = new Map<string, string>();

/** Raw unified diffs by review id. Populated by the pipeline's fetch step. */
export const reviewDiffs = {
	get: (reviewId: string): string | undefined => {
		const row = getDb()
			.query('SELECT diff FROM review_diffs WHERE review_id = ?')
			.get(reviewId) as { diff: string } | null;
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
				summary: 'Review interrupted when the server restarted. Progress and candidates were kept. Press Review to retry.',
				updatedAt: new Date().toISOString()
			});
			const progress = reviewProgress.get(review.id);
			if (progress) {
				reviewProgress.set({ ...progress, outcome: 'failed', updatedAt: new Date().toISOString() });
			}
			recovered++;
		}
		const progress = reviewProgress.get(review.id);
		if (progress?.messages?.some((message) => message.status === 'streaming') || progress?.reasoning?.some((entry) => entry.status === 'streaming')) {
			reviewProgress.set({
				...progress,
				messages: progress.messages?.map((message) => message.status === 'streaming'
					? { ...message, status: 'error', text: `${message.text}${message.text ? '\n\n' : ''}Response interrupted when the server restarted.` }
					: message),
				reasoning: progress.reasoning?.map((entry) => entry.status === 'streaming' ? { ...entry, status: 'error' } : entry)
			});
		}
	}
	if (recovered > 0) console.warn(`[store] marked ${recovered} stale review(s) as failed`);
	return recovered;
}
