import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { VllmServer } from '@recoder/shared';
import { isSealed, openStored, seal } from '../../secrets/seal.js';
import { secretPurpose } from '../../secrets/purposes.js';
import { serverDataDir } from '../../util/data-dir.js';
import { readSharedSetting, sharedSettingsActive, writeSharedSetting } from '../../config/shared-settings.js';

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

/**
 * The connected vLLM servers, in the order they were added. Each holds its key and the last model list it served.
 * The keys are plaintext here and sealed wherever the list is saved.
 */
let servers: StoredVllmServer[] = [];

function storeFile(): string {
	return `${serverDataDir()}/vllm-servers.json`;
}

function sealKeys(list: StoredVllmServer[]): StoredVllmServer[] {
	return list.map((server) =>
		server.apiKey ? { ...server, apiKey: seal(secretPurpose.vllmKey(server.id), server.apiKey) } : server
	);
}

function openKeys(list: StoredVllmServer[]): StoredVllmServer[] {
	return list.map((server) =>
		server.apiKey ? { ...server, apiKey: openStored(secretPurpose.vllmKey(server.id), server.apiKey) } : server
	);
}

function hasUnsealedKey(list: StoredVllmServer[]): boolean {
	return list.some((server) => server.apiKey !== undefined && !isSealed(server.apiKey));
}

function persist(next: StoredVllmServer[]): void {
	const sealed = sealKeys(next);

	if (sharedSettingsActive()) {
		writeSharedSetting('vllm-servers', sealed);

		return;
	}

	servers = next;

	try {
		writeFileSync(storeFile(), JSON.stringify(sealed, null, 2), { mode: 0o600 });
	} catch (err) {
		console.warn('[vllm] could not persist servers', err instanceof Error ? err.message : err);
	}
}

/**
 * Load the saved servers into memory, and save again any key that was never sealed. Call once at boot. A missing or
 * corrupt file starts empty; keys that cannot be opened stop the start, since saving over them would lose them.
 */
export function initVllmServers(): void {
	const stored = readStoredServers();

	if (stored === undefined) {
		servers = [];

		return;
	}

	if (hasUnsealedKey(stored)) persist(openKeys(stored));
	else if (!sharedSettingsActive()) servers = openKeys(stored);
}

/** The servers as saved, their keys sealed or not. Undefined when a local file is missing or not a server list. */
function readStoredServers(): StoredVllmServer[] | undefined {
	if (sharedSettingsActive()) return z.array(storedServerSchema).parse(readSharedSetting('vllm-servers') ?? []);

	try {
		const parsed = z.array(storedServerSchema).safeParse(JSON.parse(readFileSync(storeFile(), 'utf8')));

		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

export function listVllmServers(): StoredVllmServer[] {
	if (sharedSettingsActive())
		return openKeys(z.array(storedServerSchema).parse(readSharedSetting('vllm-servers') ?? []));

	return servers;
}

export function getVllmServer(id: string): StoredVllmServer | undefined {
	return listVllmServers().find((server) => server.id === id);
}

/** Adds the server, or replaces the one with its id in place, and saves. */
export function putVllmServer(server: StoredVllmServer): void {
	const servers = listVllmServers();
	const at = servers.findIndex((existing) => existing.id === server.id);

	persist(at < 0 ? [...servers, server] : servers.map((existing, index) => (index === at ? server : existing)));
}

/** Forgets the server and its key. False when there was none. */
export function removeVllmServer(id: string): boolean {
	if (!getVllmServer(id)) return false;

	persist(listVllmServers().filter((server) => server.id !== id));

	return true;
}

/** A server's id: the same base URL always gives the same one, so reconnecting keeps the models set for reviews. */
export function vllmServerId(baseUrl: string): string {
	return `v${createHash('sha1').update(baseUrl.toLowerCase()).digest('hex').slice(0, 8)}`;
}

export function vllmHost(baseUrl: string): string {
	return new URL(baseUrl).host;
}

/** The server as the UI sees it: whether it has a key, never the key. */
export function toVllmServer(server: StoredVllmServer): VllmServer {
	return {
		id: server.id,
		host: vllmHost(server.baseUrl),
		baseUrl: server.baseUrl,
		apiKeySet: !!server.apiKey,
		syncedAt: server.syncedAt,
		error: server.error,
		models: server.models
	};
}
