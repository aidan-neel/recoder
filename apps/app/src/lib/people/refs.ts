import { isBotLogin, type PersonRef, type Repo } from '@recoder/shared';

/** The forge's own host, which a person's address leaves out. */
const PUBLIC_HOSTS: Record<string, string> = { github: 'github.com', gitlab: 'gitlab.com' };

/** A login's person on the forge a repository lives on; null for a local repository, which has no people. */
export function personRefOf(repo: Pick<Repo, 'provider' | 'url'> | null | undefined, login: string): PersonRef | null {
	if (!repo || (repo.provider !== 'github' && repo.provider !== 'gitlab') || !login) return null;

	return { provider: repo.provider, host: selfManagedHost(repo.provider, repo.url), login };
}

/** The host of a self-managed GitLab; null on github.com and gitlab.com, or a URL that does not parse. */
function selfManagedHost(provider: 'github' | 'gitlab', url: string): string | null {
	if (provider === 'github') return null;

	try {
		const host = new URL(url).host;

		return host === PUBLIC_HOSTS[provider] ? null : host;
	} catch {
		return null;
	}
}

/** A profile's address: `/people/github/mira`, and `/people/gitlab/<host>/<login>` on a self-managed GitLab. */
export function personHref(base: string, { provider, host, login }: PersonRef): string {
	const place = host ? `${provider}/${encodeURIComponent(host)}` : provider;

	return `${base}/people/${place}/${encodeURIComponent(login)}`;
}

/** One key per person, for caches. */
export function personKey({ provider, host, login }: PersonRef): string {
	return `${provider}:${host ?? ''}:${login.toLowerCase()}`;
}

/** How a person goes by: their name, else their login with a bot's `[bot]` left off. */
export function displayName(person: { login: string; name?: string | null }): string {
	return person.name || (isBotLogin(person.login) ? person.login.replace(/\[bot\]$/i, '') : person.login);
}
