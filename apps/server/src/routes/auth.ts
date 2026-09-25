import { Hono } from 'hono';
import { z } from 'zod';
import type { ProviderAuth } from '@recoder/shared';
import { ghAuth, ghAvailable, listGhRepos } from '../lib/gh';
import { glabAuth, glabAvailable, listGlabRepos } from '../lib/glab';
import { GhError } from '../lib/gh';
import { getGitlabHost, normalizeGitlabHost, setGitlabHost } from '../lib/gitlab-host';
import { clearToken, setToken, tokenEnv } from '../lib/tokens';

const tokenSchema = z.object({
	provider: z.enum(['github', 'gitlab']),
	token: z.string().min(1).max(500),
	/** GitLab only: self-managed instance, e.g. `gitlab.acme.com`. Empty means gitlab.com. */
	host: z.string().max(253).optional()
});

async function githubStatus(): Promise<ProviderAuth> {
	const available = await ghAvailable();
	if (!available) return { provider: 'github', available, authenticated: false, user: null };
	const { authenticated, user } = await ghAuth(tokenEnv('github'));
	return { provider: 'github', available, authenticated, user };
}

async function gitlabStatus(): Promise<ProviderAuth> {
	const env = tokenEnv('gitlab');
	const host = getGitlabHost();
	const available = await glabAvailable();
	// A connected token talks to the REST API, so the CLI is optional.
	if (!available && !env.GITLAB_TOKEN) return { provider: 'gitlab', available, authenticated: false, user: null, host };
	const { authenticated, user } = await glabAuth(env);
	return { provider: 'gitlab', available, authenticated, user, host };
}

const app = new Hono();

app.get('/status', async (c) => {
	const [github, gitlab] = await Promise.all([githubStatus(), gitlabStatus()]);
	return c.json({ github, gitlab });
});

app.post('/token', async (c) => {
	const parsed = tokenSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const { provider, token } = parsed.data;
	const rawHost = provider === 'gitlab' ? parsed.data.host?.trim() ?? '' : '';
	const host = rawHost === '' ? null : normalizeGitlabHost(rawHost);
	if (rawHost !== '' && !host) {
		return c.json({ error: 'That GitLab URL is not a valid host.', kind: 'host' }, 400);
	}
	const candidate: Record<string, string> =
		provider === 'gitlab'
			? { GITLAB_TOKEN: token, ...(host && host !== 'gitlab.com' ? { GITLAB_HOST: host } : {}) }
			: { GH_TOKEN: token };
	const check =
		provider === 'gitlab' ? await glabAuth(candidate) : await ghAuth(candidate);
	if (!check.authenticated) {
		const error = ('error' in check && check.error) || (host ? `Token rejected by ${host}` : 'token rejected by provider CLI');
		return c.json({ error, kind: 'auth' }, 401);
	}
	setToken(provider, token);
	if (provider === 'gitlab') setGitlabHost(host);
	return c.json({ provider, user: check.user });
});

app.delete('/token/:provider', (c) => {
	const provider = c.req.param('provider');
	if (provider !== 'github' && provider !== 'gitlab') {
		return c.json({ error: 'unknown provider' }, 400);
	}
	clearToken(provider);
	return c.json({ cleared: true });
});

/** Authenticated user's repos on a provider. 502 when the CLI errors. */
app.get('/repos', async (c) => {
	const provider = c.req.query('provider');
	if (provider !== 'github' && provider !== 'gitlab') {
		return c.json({ error: 'provider must be github or gitlab' }, 400);
	}
	try {
		const repos =
			provider === 'gitlab'
				? await listGlabRepos(tokenEnv('gitlab'))
				: await listGhRepos(tokenEnv('github'));
		return c.json(repos);
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message, kind: err.kind }, 502);
		throw err;
	}
});

export default app;
