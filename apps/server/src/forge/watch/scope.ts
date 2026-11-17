import type { AutoReviewSettings, Repo } from '@recoder/shared';
import { db } from '../../store';
import { forgeAuthStatus } from '../auth-status';
import { detectProvider, parseSlug } from '../providers';
import { watchable } from './feed';

/** The login of the account each forge is connected as, or null where none is. */
export interface ForgeLogins {
	github: string | null;
	gitlab: string | null;
}

/**
 * Whether the connected account owns a repository: its path starts with the account's own namespace, so
 * `aidan/app` is owned by `aidan` and `acme/app` is not. Matched case-insensitively, as both forges match logins.
 */
export function ownsRepo(repo: Repo, logins: ForgeLogins): boolean {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') return false;

	const login = logins[provider];
	const owner = ownerOf(repo.url);

	return login !== null && owner !== null && owner.toLowerCase() === login.toLowerCase();
}

/** The tracked repositories the connected accounts own. */
export async function ownRepoIds(repos: Repo[]): Promise<string[]> {
	const logins = await connectedLogins();

	return repos.filter((repo) => ownsRepo(repo, logins)).map((repo) => repo.id);
}

/** Whether the watcher checks a repository, for a webhook naming one. */
export async function isWatchedRepo(repo: Repo, settings: AutoReviewSettings): Promise<boolean> {
	return isWatched(repo, settings, await scopeLogins(settings));
}

/** Every tracked repository the watcher checks. */
export async function watchedRepos(settings: AutoReviewSettings): Promise<Repo[]> {
	const logins = await scopeLogins(settings);

	return (await db.repos.list()).filter((repo) => isWatched(repo, settings, logins));
}

/**
 * A GitHub or GitLab repository the settings don't exclude and, when `logins` is given (`ownReposOnly` is on), one
 * the connected account owns.
 */
function isWatched(repo: Repo, settings: AutoReviewSettings, logins: ForgeLogins | null): boolean {
	if (!watchable(repo) || settings.excludedRepoIds.includes(repo.id)) return false;

	return logins === null || ownsRepo(repo, logins);
}

/** The logins to match owners against, or null while every repository is watched. */
async function scopeLogins(settings: AutoReviewSettings): Promise<ForgeLogins | null> {
	return settings.ownReposOnly ? connectedLogins() : null;
}

async function connectedLogins(): Promise<ForgeLogins> {
	const { github, gitlab } = await forgeAuthStatus();

	return {
		github: github.authenticated ? github.user : null,
		gitlab: gitlab.authenticated ? gitlab.user : null
	};
}

/** The namespace a repository lives under. A URL with no `owner/name` path has no owner, so nobody owns it. */
function ownerOf(url: string): string | null {
	try {
		return parseSlug(url).split('/')[0] ?? null;
	} catch {
		return null;
	}
}
