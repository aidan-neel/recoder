import type { ApiClient } from '../api/client';
import type { ListStore } from '../pulls/list-store';
import { createSession, type Session } from './session';

/**
 * Pull request sessions the running app keeps, so a page it returns to still
 * holds what it read last time and can paint before asking the forge again.
 */
const KEEP = 8;

/** Hovers that may be reading a page at once; the forge is slow and rate limited, so more would only queue. */
const WARMING = 2;

export interface SessionCache {
	/** The session for this pull request: the one kept from before, or a fresh one. */
	get(repoId: string, number: number): Session;
	/** Starts reading the page and its diff, so the click that follows finds them partway or done. */
	warm(repoId: string, number: number): void;
}

/** Sessions by pull request, newest read last; past {@link KEEP} the least recently read one is forgotten. */
export function createSessionCache(client: ApiClient, list: ListStore): SessionCache {
	const sessions = new Map<string, Session>();
	let warming = 0;

	function key(repoId: string, number: number): string {
		return `${repoId}#${number}`;
	}

	function get(repoId: string, number: number): Session {
		const at = key(repoId, number);
		const kept = sessions.get(at) ?? createSession(client, list, repoId, number);

		sessions.delete(at);
		sessions.set(at, kept);

		while (sessions.size > KEEP) sessions.delete(sessions.keys().next().value as string);

		return kept;
	}

	return {
		get,

		warm(repoId, number) {
			const session = get(repoId, number);
			const { page, diff } = session.state.getState();

			if (page.phase === 'ready' && diff.phase === 'ready') return;
			if (warming >= WARMING) return;

			warming += 1;

			void session.warm().finally(() => {
				warming -= 1;
			});
		}
	};
}
