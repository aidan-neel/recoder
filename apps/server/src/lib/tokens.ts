import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider } from '@recoder/shared';
import { serverDataDir } from './data-dir';
import { getGitlabHost, hostOfRepoUrl } from './gitlab-host';

type Tokens = Partial<Record<Provider, string>>;

function tokenFile(): string {
	return join(serverDataDir(), 'tokens.json');
}

function readFileTokens(file: string): Tokens | undefined {
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw new Error('Could not read saved provider tokens');
	}
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		const tokens: Tokens = {};
		for (const provider of ['github', 'gitlab'] as const) {
			if (typeof parsed[provider] === 'string' && parsed[provider]) tokens[provider] = parsed[provider];
		}
		return tokens;
	} catch {
		throw new Error('Saved provider tokens are invalid; refusing to overwrite them');
	}
}

/** Replace atomically: failed saves leave the previous credentials intact. */
function persist(tokens: Tokens): void {
	const file = tokenFile();
	const temporary = file + '.' + crypto.randomUUID() + '.tmp';
	try {
		const fd = openSync(temporary, 'wx', 0o600);
		try {
			writeFileSync(fd, JSON.stringify(tokens));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, file);
	} catch {
		throw new Error('Could not save provider tokens to disk');
	} finally {
		try { unlinkSync(temporary); } catch { /* Already renamed or never created. */ }
	}
}

function readStored(): Tokens {
	const primary = readFileTokens(tokenFile());
	// An empty primary is intentional (disconnect); never resurrect legacy tokens.
	if (primary !== undefined) return primary;
	const legacy = readFileTokens(join(process.cwd(), 'data', 'tokens.json'));
	if (legacy !== undefined) {
		persist(legacy);
		return legacy;
	}
	return {};
}

/** Migrate legacy credentials at boot. Disk remains authoritative across hot reloads. */
export function initTokenStore(): void {
	readStored();
}

export function setToken(provider: Provider, token: string): void {
	persist({ ...readStored(), [provider]: token });
}

export function clearToken(provider: Provider): void {
	const tokens = readStored();
	delete tokens[provider];
	persist(tokens);
}

export function getToken(provider: Provider): string | undefined {
	// Environment overrides are never copied into the persisted credentials.
	return (provider === 'gitlab' ? process.env.GITLAB_TOKEN : process.env.GH_TOKEN) || readStored()[provider];
}

export function hasToken(provider: Provider): boolean {
	return getToken(provider) !== undefined;
}

/**
 * Env for a provider CLI call. GitLab also gets `GITLAB_HOST`: the repo's own
 * host when there is one, else the configured self-managed instance.
 */
export function tokenEnv(provider: Provider, repoUrl?: string): Record<string, string> {
	const token = getToken(provider);
	if (provider === 'github') return token ? { GH_TOKEN: token } : {};
	const host = (repoUrl ? hostOfRepoUrl(repoUrl) : null) ?? getGitlabHost();
	return { ...(token ? { GITLAB_TOKEN: token } : {}), ...(host ? { GITLAB_HOST: host } : {}) };
}
