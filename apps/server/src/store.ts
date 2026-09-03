import type { CommandRun, Repo, Review } from '@recoder/shared';

function createCollection<T extends { id: string }>() {
	const items = new Map<string, T>();
	return {
		list: (): T[] => [...items.values()],
		get: (id: string): T | undefined => items.get(id),
		set: (item: T): T => {
			items.set(item.id, item);
			return item;
		},
		delete: (id: string): boolean => items.delete(id),
		clear: (): void => items.clear()
	};
}

/**
 * In-memory store. Good enough for the scaffold and trivially replaceable:
 * keep the collection shape and back it with SQLite/Postgres later.
 */
export const db = {
	repos: createCollection<Repo>(),
	reviews: createCollection<Review>(),
	runs: createCollection<CommandRun>()
};
