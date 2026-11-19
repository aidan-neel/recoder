import type { Database } from 'bun:sqlite';
import { reviewListItem } from '@recoder/shared';

/**
 * The shape the stored projections were made with: a hash of the function that makes them. An upgrade that changes
 * `reviewListItem` gets a new hash, and the projections made by the old one are dropped and rebuilt on the next read
 * rather than served without the fields the new app expects.
 */
const PROJECTION_SHAPE = String(Bun.hash(reviewListItem.toString()));

/**
 * The review list's own tables: each review's list projection, which a trigger drops when the review changes (from
 * this server or another process), and a revision that any review or pull-state write bumps, so the serialized full
 * list is reused only while nothing it holds has changed.
 */
export function prepareReviewList(handle: Database): void {
	handle.run('CREATE TABLE IF NOT EXISTS review_list_items (id TEXT PRIMARY KEY, value TEXT NOT NULL)');

	for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
		const record = event === 'INSERT' ? 'new' : 'old';

		handle.run(`CREATE TRIGGER IF NOT EXISTS review_list_${event.toLowerCase()} AFTER ${event} ON reviews
			BEGIN DELETE FROM review_list_items WHERE id = ${record}.id; END`);
	}

	handle.run('CREATE TABLE IF NOT EXISTS review_list_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
	handle.run('INSERT OR IGNORE INTO review_list_revision (id, revision) VALUES (1, 0)');

	for (const table of ['reviews', 'pull_states']) {
		for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
			handle.run(`CREATE TRIGGER IF NOT EXISTS review_response_${table}_${event.toLowerCase()}
				AFTER ${event} ON ${table} BEGIN UPDATE review_list_revision SET revision = revision + 1 WHERE id = 1; END`);
		}
	}

	handle.run('CREATE TABLE IF NOT EXISTS review_list_shape (id INTEGER PRIMARY KEY, shape TEXT NOT NULL)');
}

/** Drops projections made by another version of `reviewListItem`. */
export function refreshReviewListShape(handle: Database): void {
	handle
		.transaction(() => {
			const stored = handle.query<{ shape: string }, []>('SELECT shape FROM review_list_shape WHERE id = 1').get();

			if (stored?.shape === PROJECTION_SHAPE) return;

			handle.run('DELETE FROM review_list_items');
			handle.run('INSERT OR REPLACE INTO review_list_shape (id, shape) VALUES (1, ?)', [PROJECTION_SHAPE]);
		})
		.immediate();
}
