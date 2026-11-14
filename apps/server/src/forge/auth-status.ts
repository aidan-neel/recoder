import type { ProviderAuth } from '@recoder/shared';
import { TtlCache } from '../util/ttl-cache';
import { ghAuth, ghAvailable } from './gh';
import { getGitlabHost } from './gitlab-host';
import { glabAuth, glabAvailable } from './glab';
import { tokenEnv } from './tokens';

interface ForgeAuthStatus {
	github: ProviderAuth;
	gitlab: ProviderAuth;
}

const statusCache = new TtlCache<ForgeAuthStatus>(30_000);

/**
 * Each forge's sign-in state. The CLI checks take a while, so once the last answer is old it is still served at
 * once while a fresh check runs behind it. Saving or clearing a token clears the cache, so that change is never
 * served stale.
 */
export function forgeAuthStatus(): Promise<ForgeAuthStatus> {
	return statusCache.stale('status', checkForges);
}

/** Both forges' sign-in state, checked side by side. */
async function checkForges(): Promise<ForgeAuthStatus> {
	const [github, gitlab] = await Promise.all([githubStatus(), gitlabStatus()]);

	return { github, gitlab };
}

async function githubStatus(): Promise<ProviderAuth> {
	const available = await ghAvailable();

	if (!available) return { provider: 'github', available, authenticated: false, user: null };

	const { authenticated, user } = await ghAuth(tokenEnv('github'));

	return { provider: 'github', available, authenticated, user };
}

/** GitLab's connection. A connected token talks to the REST API, so the CLI is optional. */
async function gitlabStatus(): Promise<ProviderAuth> {
	const env = tokenEnv('gitlab');
	const host = getGitlabHost();
	const available = await glabAvailable();

	if (!available && !env.GITLAB_TOKEN) return { provider: 'gitlab', available, authenticated: false, user: null, host };

	const { authenticated, user } = await glabAuth(env);

	return { provider: 'gitlab', available, authenticated, user, host };
}
