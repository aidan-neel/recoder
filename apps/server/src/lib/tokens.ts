import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider } from '@recoder/shared';

/**
 * CLI tokens for gh/glab, set from the UI (`POST /api/auth/token`).
 *
 * Persisted to disk (0600) so reconnects survive restarts — same tradeoff
 * the gh CLI itself makes with ~/.config/gh/hosts.yml. Process env
 * (`GH_TOKEN` / `GITLAB_TOKEN`) still takes precedence when set; the stored
 * token is only a fallback.
 */
const store = new Map<Provider, string>();

function dataDir(): string {
	return process.env.RECODER_DATA_DIR ?? './data';
}

function tokenFile(): string {
	return join(dataDir(), 'tokens.json');
}

function readStored(): Partial<Record<Provider, string>> {
	try {
		const raw = readFileSync(tokenFile(), 'utf8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const out: Partial<Record<Provider, string>> = {};
		for (const provider of ['github', 'gitlab'] as const) {
			if (typeof parsed[provider] === 'string' && parsed[provider] !== '') {
				out[provider] = parsed[provider];
			}
		}
		return out;
	} catch {
		return {};
	}
}

function persist(): void {
	try {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(tokenFile(), JSON.stringify(Object.fromEntries(store)), { mode: 0o600 });
	} catch (err) {
		console.warn('[auth] could not persist tokens', err instanceof Error ? err.message : err);
	}
}

/** Load persisted tokens into memory. Call once at boot. */
export function initTokenStore(): void {
	for (const provider of ['github', 'gitlab'] as const) {
		// Process env wins — it works without any stored state.
		const fromEnv = provider === 'gitlab' ? process.env.GITLAB_TOKEN : process.env.GH_TOKEN;
		if (fromEnv) {
			store.set(provider, fromEnv);
			continue;
		}
		const stored = readStored()[provider];
		if (stored) store.set(provider, stored);
	}
}

export function setToken(provider: Provider, token: string): void {
	store.set(provider, token);
	persist();
}

export function clearToken(provider: Provider): void {
	store.delete(provider);
	persist();
}

export function hasToken(provider: Provider): boolean {
	return store.has(provider);
}

/** Env override carrying the stored token (empty when unset). */
export function tokenEnv(provider: Provider): Record<string, string> {
	const token = store.get(provider);
	if (!token) return {};
	return provider === 'gitlab' ? { GITLAB_TOKEN: token } : { GH_TOKEN: token };
}
