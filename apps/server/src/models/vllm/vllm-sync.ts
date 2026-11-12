import { parseVllmModelId, vllmModelId, type DiscoveredModel, type VllmModel } from '@recoder/shared';
import { getStoredSettings, saveReviewSettings } from '../../review/session/review-settings.js';
import { discoverModels, normalizeEndpoint } from '../model-discovery.js';
import { getVllmServer, listVllmServers, putVllmServer, vllmServerId, type StoredVllmServer } from './vllm-store.js';

/** How often the model lists are checked again while the server runs. */
export const VLLM_SYNC_INTERVAL_MS = 5 * 60_000;

/** A refresh that is not forced skips a server that was tried this recently, so opening Settings twice asks once. */
const THROTTLE_MS = 15_000;

const EMPTY_LIST = 'The server answered but listed no models.';

/** A connect that cannot proceed; `status` is the HTTP status the route answers with. */
export class VllmConnectError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 422 | 502
	) {
		super(message);
		this.name = 'VllmConnectError';
	}
}

/** When each server was last asked, in this process. */
const attempted = new Map<string, number>();

const inflight = new Map<string, Promise<void>>();

/** The models a review is set to run on this server: its Review, Subagent, Verifier and older shared picks. */
function pickedOn(serverId: string): Set<string> {
	const { orchestratorModelId, specialistModelId, verifierModelId, sharedModelId } = getStoredSettings();
	const picked = new Set<string>();

	for (const id of [orchestratorModelId, specialistModelId, verifierModelId, sharedModelId]) {
		const parsed = id ? parseVllmModelId(id) : null;

		if (parsed?.serverId === serverId) picked.add(parsed.model);
	}

	return picked;
}

/**
 * The server's list after a sync: what it serves now, in its order. A model it
 * stopped serving is dropped, unless a review is still set to it. That one
 * stays, marked not served, so the pick shows as missing instead of vanishing.
 */
export function mergeServed(
	previous: readonly VllmModel[],
	served: readonly DiscoveredModel[],
	picked: ReadonlySet<string>
): VllmModel[] {
	const now = new Map<string, VllmModel>();

	for (const model of served) now.set(model.id, { id: model.id, contextWindow: model.contextWindow, served: true });

	for (const model of previous) {
		if (!now.has(model.id) && picked.has(model.id)) now.set(model.id, { ...model, served: false });
	}

	return [...now.values()];
}

/**
 * Why a sync failed, for the person reading Settings. A refused or lost
 * connection is the runtime's wording ("Unable to connect. Is the computer
 * able to access the url?") and an error status names the URL, so both are
 * replaced by words that say what to check.
 */
function failureText(err: unknown): string {
	const message = err instanceof Error ? err.message : '';
	const host = message.match(/^Couldn't reach (\S+): /)?.[1];

	const status = message.match(/\/models returned (\d{3})$/)?.[1];

	if (/timed out|timeout/i.test(message)) return 'The server did not answer in time.';
	if (status) return `The server answered with an error (${status}).`;
	if (host && /unable to connect|refused|typo in the url|not found|getaddrinfo/i.test(message))
		return `Couldn’t reach ${host}. Is the server running, and is the address right?`;

	return message || 'Could not reach the server.';
}

/** Applies a sync's result to the server as it is now. A server disconnected or given a new key meanwhile is left as it is. */
function record(started: StoredVllmServer, change: Partial<StoredVllmServer>): void {
	const current = getVllmServer(started.id);

	if (!current || current.apiKey !== started.apiKey) return;

	putVllmServer({ ...current, ...change });
}

async function runSync(id: string): Promise<void> {
	const server = getVllmServer(id);

	if (!server) return;

	attempted.set(id, Date.now());

	try {
		const { models } = await discoverModels(server.baseUrl, server.apiKey);

		if (models.length === 0) throw new Error(EMPTY_LIST);

		record(server, {
			syncedAt: Date.now(),
			error: null,
			models: mergeServed(getVllmServer(id)?.models ?? server.models, models, pickedOn(id))
		});
	} catch (err) {
		record(server, { error: failureText(err) });
	}
}

/** Brings one server's model list in step with what it serves. A failure keeps the last good list and records why. */
export function syncVllmServer(id: string): Promise<void> {
	const running = inflight.get(id);

	if (running) return running;

	const run = runSync(id).finally(() => inflight.delete(id));

	inflight.set(id, run);

	return run;
}

/** Syncs every server. Without `force`, one asked in the last few seconds is left alone. */
export async function syncAllVllm(force = false): Promise<void> {
	const now = Date.now();

	await Promise.all(
		listVllmServers()
			.filter((server) => force || now - (attempted.get(server.id) ?? 0) > THROTTLE_MS)
			.map((server) => syncVllmServer(server.id))
	);
}

/** Syncs now, then on a timer for as long as the server runs. */
export function startVllmSync(): void {
	void syncAllVllm(true);
	setInterval(() => void syncAllVllm(true), VLLM_SYNC_INTERVAL_MS).unref();
}

/** The saved server a pasted address names, with or without its `/v1`. */
function savedFor(address: string): StoredVllmServer | undefined {
	return listVllmServers().find((server) => server.baseUrl === address || server.baseUrl === `${address}/v1`);
}

/** The pasted address as a URL, or a plain reason it is not one. */
function checkedAddress(raw: string): string {
	const address = normalizeEndpoint(raw);

	try {
		new URL(address);
	} catch {
		throw new VllmConnectError('That doesn’t look like a server address. Try http://host:8000.', 400);
	}

	return address;
}

/** With nothing picked for Review yet, the first model the server serves becomes it, so a first connection works at once. */
function pickFirstModel(server: StoredVllmServer): void {
	const { orchestratorModelId, sharedModelId } = getStoredSettings();
	const first = server.models.find((model) => model.served);

	if (first && !orchestratorModelId && !sharedModelId) {
		saveReviewSettings({ orchestratorModelId: vllmModelId(server.id, first.id) });
	}
}

/**
 * Connects a vLLM server: its address (a missing `/v1` is added) and an
 * optional key, checked by listing its models. The same address again updates
 * its key and list. An empty key keeps the saved one.
 */
export async function connectVllm(address: string, apiKey: string | undefined): Promise<StoredVllmServer> {
	const checked = checkedAddress(address);
	const key = apiKey?.trim() || savedFor(checked)?.apiKey;
	let found: Awaited<ReturnType<typeof discoverModels>>;

	try {
		found = await discoverModels(checked, key);
	} catch (err) {
		throw new VllmConnectError(failureText(err), 502);
	}

	if (found.models.length === 0) throw new VllmConnectError(EMPTY_LIST, 422);

	const id = vllmServerId(found.baseUrl);
	const kept = getVllmServer(id);

	const server: StoredVllmServer = {
		id,
		baseUrl: found.baseUrl,
		...(key ? { apiKey: key } : {}),
		syncedAt: Date.now(),
		error: null,
		models: mergeServed(kept?.models ?? [], found.models, pickedOn(id))
	};

	putVllmServer(server);
	attempted.set(id, Date.now());
	pickFirstModel(server);

	return server;
}
