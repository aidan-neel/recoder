import type { VllmServer } from '@recoder/shared';

import { plural, span } from '../shell/format';

/** A server's reason with a full stop, since the server words it as it likes. */
function sentence(text: string): string {
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** When the list last matched the server: "just now", or "2 minutes ago". */
function syncedAgo(syncedAt: number, now: number): string {
	return now - syncedAt < 10_000 ? 'just now' : `${span(now - syncedAt)} ago`;
}

/**
 * The line under a server's name: how many models it serves and when they
 * were captured, or why the last sync failed and how old the list on screen is.
 */
export function syncLine(server: VllmServer, now: number): string {
	const served = server.models.filter((model) => model.served).length;
	const missing = server.models.length - served;

	if (server.error) {
		const kept = server.syncedAt ? ` Showing the list from ${syncedAgo(server.syncedAt, now)}.` : '';

		return `${sentence(server.error)}${kept}`;
	}

	const count = `${plural(served, 'model')}${missing ? ` · ${missing} not served` : ''}`;

	return server.syncedAt ? `${count} · Synced ${syncedAgo(server.syncedAt, now)}` : count;
}
