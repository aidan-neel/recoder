import { currentUsageResources } from '../../models/usage-resources';
import type { NewSession, OpenCodeApi } from './api/types';
import type { OpenCodeServer } from './opencode-server';

/** An unprompted, deny-all parent gives every session of this review or chat one provider cache affinity. */
export function cacheRoot(server: OpenCodeServer, api: OpenCodeApi, request: NewSession): Promise<string | undefined> {
	const resources = currentUsageResources();

	if (!resources) return Promise.resolve(undefined);

	const existing = resources.values.get(server);

	if (existing) return existing;

	const root = api.createSession({ ...request, system: '', allow: [], parentID: undefined }).catch((error: unknown) => {
		console.warn(
			`[opencode] Could not create the shared prompt-cache session (${reason(error)}); using independent sessions.`
		);

		return undefined;
	});

	resources.values.set(server, root);

	resources.cleanup.push(async () => {
		const id = await root;

		if (id)
			await api.deleteSession(request.directory, id).catch((error: unknown) => {
				console.warn(`[opencode] Could not delete the shared prompt-cache session (${reason(error)}).`);
			});
	});

	return root;
}

/** A failure's message for a log line. */
function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
