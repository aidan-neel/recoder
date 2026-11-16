import type { Database } from 'bun:sqlite';
import { postgres } from './backend';
import { sqlite } from './sqlite';

interface Version {
	database: Database;
	revision: number;
}

let cached: (Version & { json: string }) | undefined;
let pending: (Version & { promise: Promise<string> }) | undefined;

/** The review list's revision; `prepareReviewList` creates its one row when the database opens, so it is always there. */
function revision(database: Database): number {
	return (
		database.query<{ revision: number }, []>('SELECT revision FROM review_list_revision WHERE id = 1').get()
			?.revision ?? 0
	);
}

function matches<Held extends Version>(
	version: Held | undefined,
	database: Database,
	current: number
): version is Held {
	return version?.database === database && version.revision === current;
}

/**
 * Reuse full-list serialization until SQLite's review or pull-state triggers bump its revision, even across
 * processes. An intervening write prevents an old load from filling the cache. PostgreSQL always reads afresh;
 * its transaction can include changes this process has not committed yet.
 */
export async function reviewListJson(load: () => Promise<string>): Promise<string> {
	if (postgres) return load();

	const database = sqlite();
	const current = revision(database);

	if (matches(cached, database, current)) return cached.json;
	if (matches(pending, database, current)) return pending.promise;

	const promise = load()
		.then((json) => {
			if (sqlite() === database && revision(database) === current) cached = { database, revision: current, json };

			return json;
		})
		.finally(() => {
			if (pending?.promise === promise) pending = undefined;
		});

	pending = { database, revision: current, promise };

	return promise;
}
