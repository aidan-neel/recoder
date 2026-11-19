import type { ServerCheck, SignInForge } from '@recoder/shared';
import { findAdmin } from '../../accounts/account-store';
import { parseForgeUser, type ForgeTarget } from '../../accounts/forge-oauth';
import { ghAuth } from '../../forge/gh';
import { getGitlabHost } from '../../forge/gitlab-host';
import { glabAuth } from '../../forge/glab';
import { getToken, tokenEnv } from '../../forge/tokens';

export function forgeName(provider: SignInForge): string {
	return provider === 'github' ? 'GitHub' : 'GitLab';
}

export async function checkForge(): Promise<ServerCheck> {
	const id = 'forge';
	const admin = await findAdmin();
	const forges = admin?.forges ?? [];
	const names = forges.map(({ provider }) => forgeName(provider)).join(' and ');
	const results = await Promise.all(forges.map(({ provider }) => tokenStatus(provider)));
	const fix = 'Check the account in Settings → Connections.';

	if (!results.length) return { id, state: 'fail', detail: 'No administrator forge is connected.', fix };

	if (results.includes('rejected')) {
		return { id, state: 'fail', detail: 'Could not verify an administrator forge connection.', fix };
	}

	if (results.includes('limited')) {
		return { id, state: 'warn', detail: 'A forge token is missing repository permissions.', fix };
	}

	return { id, state: 'ok', detail: `${names} accepted the server’s connection.` };
}

async function tokenStatus(provider: SignInForge): Promise<'accepted' | 'limited' | 'rejected'> {
	try {
		const token = getToken(provider);

		if (!token) {
			const auth = await (provider === 'github' ? ghAuth : glabAuth)(tokenEnv(provider));

			return auth.authenticated ? 'accepted' : 'rejected';
		}

		const target = { provider, host: provider === 'gitlab' ? getGitlabHost() : null };

		return await checkToken(target, token);
	} catch {
		return 'rejected';
	}
}

async function checkToken(target: ForgeTarget, token: string): Promise<'accepted' | 'limited' | 'rejected'> {
	const github = target.provider === 'github';
	const gitlab = `https://${target.host ?? 'gitlab.com'}`;

	const options = {
		headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
		redirect: 'error' as const,
		signal: AbortSignal.timeout(5000)
	};

	const response = await fetch(github ? 'https://api.github.com/user' : `${gitlab}/api/v4/user`, options);

	if (!response.ok) {
		await response.body?.cancel();

		return 'rejected';
	}

	parseForgeUser(await response.json());

	if (github) {
		const advertised = response.headers.get('x-oauth-scopes');
		const scopes = advertised?.split(',').map((scope) => scope.trim());

		return scopes && !scopes.includes('repo') ? 'limited' : 'accepted';
	}

	return (await gitlabScopes(gitlab, options))?.includes('api') === false ? 'limited' : 'accepted';
}

async function gitlabScopes(base: string, options: RequestInit): Promise<string[] | undefined> {
	for (const path of ['/api/v4/personal_access_tokens/self', '/oauth/token/info']) {
		try {
			const response = await fetch(base + path, options);

			if (!response.ok) {
				await response.body?.cancel();
				continue;
			}

			const body = (await response.json()) as { scopes?: unknown; scope?: unknown };
			const scopes = body.scopes ?? body.scope;

			if (Array.isArray(scopes) && scopes.every((scope): scope is string => typeof scope === 'string')) {
				return scopes;
			}
		} catch {}
	}

	return undefined;
}
