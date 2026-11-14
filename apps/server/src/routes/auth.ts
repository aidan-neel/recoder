import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { forgeAuthStatus } from '../forge/auth-status';
import { ghAuth, listGhRepos } from '../forge/gh';
import { glabAuth, listGlabRepos } from '../forge/glab';
import { GhError } from '../forge/gh';
import { findAdmin, updateLinkedForge } from '../accounts/account-store';
import { currentAccount, hasBearerAccess } from '../accounts/enforcement';
import { isKnownHost } from '../accounts/forge-host';
import { ForgeOAuthError } from '../accounts/forge-oauth';
import { knownForgeHosts } from '../accounts/members';
import { setSessionCookie } from '../accounts/session-cookie';
import { refuseWhileLocked } from '../accounts/setup-gate';
import { completeSignIn } from '../accounts/sign-in';
import { normalizeGitlabHost } from '../forge/gitlab-host';
import { clearAllCaches } from '../util/ttl-cache';
import { clearToken, tokenEnv } from '../forge/tokens';
import { parseBody } from './parse-body';
import { trustedOrigin } from './trusted-origin';

const tokenSchema = z.object({
	provider: z.enum(['github', 'gitlab']),
	token: z.string().min(1).max(500),
	/** GitLab only: self-managed instance, e.g. `gitlab.acme.com`. Empty means gitlab.com. */
	host: z.string().max(253).optional()
});

const app = new Hono();

app.use('/token', trustedOrigin);

app.get('/status', async (c) => c.json(await forgeAuthStatus()));

app.post('/token', async (c) => {
	const body = await parseBody(c, tokenSchema);

	if (body instanceof Response) return body;

	const locked = await refuseWhileLocked(c);

	if (locked) return locked;

	const { provider, token } = body;
	const rawHost = provider === 'gitlab' ? (body.host?.trim() ?? '') : '';
	const normalized = rawHost === '' ? null : normalizeGitlabHost(rawHost);

	if (rawHost !== '' && !normalized) {
		return c.json({ error: 'That GitLab URL is not a valid host.', kind: 'host' }, 400);
	}

	const host = normalized === 'gitlab.com' ? null : normalized;

	const stored = await findAdmin();
	const linkTo = stored ? await linkingAccountId(c, stored.id) : null;

	if (stored && linkTo === null && !isKnownHost({ provider, host }, await knownForgeHosts())) {
		return c.json({ error: 'Sign in with a forge host this server already knows.', kind: 'host' }, 400);
	}

	const candidate: Record<string, string> =
		provider === 'gitlab' ? { GITLAB_TOKEN: token, ...(host ? { GITLAB_HOST: host } : {}) } : { GH_TOKEN: token };

	const check = provider === 'gitlab' ? await glabAuth(candidate) : await ghAuth(candidate);

	if (!check.authenticated) {
		const error =
			('error' in check && check.error) || (host ? `Token rejected by ${host}` : 'token rejected by provider CLI');

		return c.json({ error, kind: 'auth' }, 401);
	}

	try {
		const outcome = await completeSignIn(
			{ provider, host },
			{ accessToken: token, refreshToken: null, expiresAt: null },
			linkTo
		);

		if (outcome.kind === 'rejected') {
			return c.json({ error: 'That token belongs to a different account than this server’s.', kind: 'account' }, 403);
		}

		if (outcome.signIn.session) setSessionCookie(c, outcome.signIn.session);
	} catch (error) {
		if (error instanceof ForgeOAuthError) return c.json({ error: error.message, kind: error.reason }, 502);
		throw error;
	}

	return c.json({ provider, user: check.user });
});

/**
 * The account a pasted token links to: the admin, when the request is the admin's session or the bearer token
 * programs on this machine use. Otherwise it is null, and the token is a sign-in, which makes the person a member
 * unless they were removed; a member cannot link more forges.
 */
async function linkingAccountId(c: Context, adminId: string): Promise<string | null> {
	if (hasBearerAccess(c)) return adminId;

	return (await currentAccount(c))?.role === 'admin' ? adminId : null;
}

app.delete('/token/:provider', async (c) => {
	const provider = c.req.param('provider');

	if (provider !== 'github' && provider !== 'gitlab') {
		return c.json({ error: 'unknown provider' }, 400);
	}

	clearToken(provider);
	await updateLinkedForge(provider, (forge) => (forge.refresh ? { ...forge, refresh: null } : undefined));
	clearAllCaches();

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
			provider === 'gitlab' ? await listGlabRepos(tokenEnv('gitlab')) : await listGhRepos(tokenEnv('github'));

		return c.json(repos);
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message, kind: err.kind }, 502);
		throw err;
	}
});

export default app;
