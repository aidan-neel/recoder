import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { VllmServer } from '@recoder/shared';
import { maskKey } from '../../review/session/review-settings.js';
import { serverDataDir } from '../../util/data-dir.js';

const storedServerSchema = z.object({
	id: z.string().min(1).max(40),
	baseUrl: z.string().min(1).max(500),
	apiKey: z.string().max(500).optional(),
	syncedAt: z.number().nullable(),
	error: z.string().max(500).nullable(),
	models: z.array(
		z.object({
			id: z.string().min(1).max(300),
			contextWindow: z.number().int().positive().nullable(),
			served: z.boolean()
		})
	)
});

export type StoredVllmServer = z.infer<typeof storedServerSchema>;

/** The connected vLLM servers, in the order they were added. Each holds its key and the last model list it served. */
let servers: StoredVllmServer[] = [];

function storeFile(): string {
	return `${serverDataDir()}/vllm-servers.json`;
}

function persist(): void {
	try {
		writeFileSync(storeFile(), JSON.stringify(servers, null, 2), { mode: 0o600 });
	} catch (err) {
		console.warn('[vllm] could not persist servers', err instanceof Error ? err.message : err);
	}
}

/** Load the saved servers into memory. Call once at boot. A missing or corrupt file starts empty. */
export function initVllmServers(): void {
	try {
		const parsed = z.array(storedServerSchema).safeParse(JSON.parse(readFileSync(storeFile(), 'utf8')));

		servers = parsed.success ? parsed.data : [];
	} catch {
		servers = [];
	}
}

export function listVllmServers(): StoredVllmServer[] {
	return servers;
}

export function getVllmServer(id: string): StoredVllmServer | undefined {
	return servers.find((server) => server.id === id);
}

/** Adds the server, or replaces the one with its id in place, and saves. */
export function putVllmServer(server: StoredVllmServer): void {
	const at = servers.findIndex((existing) => existing.id === server.id);

	servers = at < 0 ? [...servers, server] : servers.map((existing, index) => (index === at ? server : existing));
	persist();
}

/** Forgets the server and its key. False when there was none. */
export function removeVllmServer(id: string): boolean {
	if (!getVllmServer(id)) return false;

	servers = servers.filter((server) => server.id !== id);
	persist();

	return true;
}

/** A server's id: the same base URL always gives the same one, so reconnecting keeps the models set for reviews. */
export function vllmServerId(baseUrl: string): string {
	return `v${createHash('sha1').update(baseUrl.toLowerCase()).digest('hex').slice(0, 8)}`;
}

export function vllmHost(baseUrl: string): string {
	return new URL(baseUrl).host;
}

/** The server as the UI sees it: the key is masked. */
export function toVllmServer(server: StoredVllmServer): VllmServer {
	return {
		id: server.id,
		host: vllmHost(server.baseUrl),
		baseUrl: server.baseUrl,
		apiKeyPreview: maskKey(server.apiKey),
		syncedAt: server.syncedAt,
		error: server.error,
		models: server.models
	};
}
