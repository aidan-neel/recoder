import type { Repo } from '@recoder/shared';

import { reviewsApi } from '../api/reviews';

/** Names rarely change, so a list this fresh serves every review page opened meanwhile. */
const FRESH_MS = 5 * 60_000;

let names: Map<string, string> | null = null;
let readAt = 0;
let reading: Promise<Repo[]> | null = null;

/** A repository's name as last read, for a header that paints before any request answers; null when not read yet. */
export function knownRepoName(repoId: string): string | null {
	return names?.get(repoId) ?? null;
}

/** Keeps each repository's name by id from a list the server sent, and returns them. */
function remember(repos: Repo[]): Map<string, string> {
	names = new Map(repos.map((repo) => [repo.id, repo.name]));
	readAt = Date.now();

	return names;
}

/**
 * The tracked repositories, fresh from the server. Callers that ask while a
 * read runs share it, and every answer refreshes the names below, so the
 * queue's refresh also serves the review pages opened after it. Rejects when
 * the server cannot answer.
 */
export function readRepos(): Promise<Repo[]> {
	reading ??= reviewsApi
		.repos()
		.then((repos) => {
			remember(repos);

			return repos;
		})
		.finally(() => {
			reading = null;
		});

	return reading;
}

/** Every tracked repository's name by id, read at most once every few minutes. Rejects when the server cannot answer. */
export function repoNames(): Promise<Map<string, string>> {
	if (names && Date.now() - readAt < FRESH_MS) return Promise.resolve(names);

	return readRepos().then(remember);
}
