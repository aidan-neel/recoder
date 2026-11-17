import { AsyncLocalStorage } from 'node:async_hooks';

interface UsageResources {
	users: number;
	values: Map<object, Promise<string | undefined>>;
	cleanup: (() => Promise<void>)[];
}

const owners = new Map<string, UsageResources>();
const current = new AsyncLocalStorage<UsageResources>();

/** Resources shared by concurrent work for one review or chat, released after its last caller settles. */
export async function withUsageResources<T>(ownerId: string, run: () => T): Promise<Awaited<T>> {
	const resources = owners.get(ownerId) ?? { users: 0, values: new Map(), cleanup: [] };

	owners.set(ownerId, resources);
	resources.users++;

	try {
		return await current.run(resources, run);
	} finally {
		resources.users--;

		if (resources.users === 0) {
			owners.delete(ownerId);
			await Promise.all(resources.cleanup.map((close) => close()));
		}
	}
}

/** The active owner's private resources; absent for calls made outside a review or chat. */
export function currentUsageResources(): UsageResources | undefined {
	return current.getStore();
}
