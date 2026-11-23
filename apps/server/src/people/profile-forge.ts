import { isBotLogin, type PersonIdentity, type PersonRef, type PullRequest, type Repo } from '@recoder/shared';
import { extractJson, gh, GhError, parsePullRow, parseRepoSlug } from '../forge/gh';
import { gitlabGet, gitlabProject, parseGitlabPullRow } from '../forge/gitlab-api';
import { getGitlabHost } from '../forge/gitlab-host';
import { githubRest, githubToken } from '../forge/github-rest';
import { glabApi } from '../forge/glab';
import { gitlabEntry } from '../forge/pulls/gitlab';
import { record, records, type PullEntry } from '../forge/pulls/status';
import { getToken } from '../forge/tokens';
import { TtlCache } from '../util/ttl-cache';

const CACHE_MS = 5 * 60_000;
const PAGE_SIZE = 100;

const identities = new TtlCache<{ person: PersonIdentity; remoteId: string } | null>(CACHE_MS, 300, CACHE_MS);
const merged = new TtlCache<MergedPull[]>(CACHE_MS, 500, 10_000);
const mergedDetails = new TtlCache<PullEntry>(CACHE_MS);
const authors = new TtlCache<Pick<PullRequest, 'author' | 'authorAvatarUrl'> | null>(CACHE_MS, 500, 10_000);

export const profileLogin = /^[a-z0-9_][a-z0-9_.-]{0,99}(?:\[bot\])?$/i;

export interface MergedPull {
	number: number;
	mergedAt: string;
	entry?: PullEntry;
}

function github(path: string): Promise<unknown> {
	if (githubToken() || !Bun.which('gh')) return githubRest(path);

	return gh(['api', path]).then(extractJson);
}

function gitlab(path: string, host: string | null): Promise<unknown> {
	const env = { GITLAB_HOST: host ?? 'gitlab.com' };

	if (host !== getGitlabHost()) return gitlabGet(path, env);

	const token = getToken('gitlab');

	return glabApi(path, { ...env, ...(token && { GITLAB_TOKEN: token }) });
}

export function fallbackIdentity(ref: PersonRef): PersonIdentity {
	const host = ref.provider === 'github' ? 'github.com' : (ref.host ?? 'gitlab.com');

	return {
		...ref,
		name: null,
		avatarUrl: null,
		forgeUrl: `https://${host}/${encodeURIComponent(ref.login)}`,
		bot: isBotLogin(ref.login)
	};
}

export function forgeIdentity(ref: PersonRef): Promise<{ person: PersonIdentity; remoteId: string } | null> {
	return identities.get(JSON.stringify([ref.provider, ref.host, ref.login.toLowerCase()]), async () => {
		const username = encodeURIComponent(ref.login);

		const user =
			ref.provider === 'github'
				? record(await github(`users/${username}`))
				: records(await gitlab(`users?username=${username}`, ref.host)).find(
						(row) => String(row.username).toLowerCase() === ref.login.toLowerCase()
					);

		const login = user?.[ref.provider === 'github' ? 'login' : 'username'];

		if (!user || typeof login !== 'string' || !profileLogin.test(login)) return null;
		if (typeof user.id !== 'number' && typeof user.id !== 'string') return null;

		const person: PersonIdentity = {
			...fallbackIdentity({ ...ref, login }),
			name: typeof user.name === 'string' && user.name ? user.name : null,
			avatarUrl: typeof user.avatar_url === 'string' && user.avatar_url.startsWith('https://') ? user.avatar_url : null,
			bot: user.type === 'Bot' || user.bot === true || isBotLogin(login)
		};

		return { person, remoteId: String(user.id) };
	});
}

export function mergedPulls(repo: Repo, ref: PersonRef, cutoff: string): Promise<MergedPull[]> {
	const day = cutoff.slice(0, 10);
	const key = JSON.stringify([repo.id, repo.url, ref.host, ref.login.toLowerCase(), day]);

	return merged.get(key, () =>
		ref.provider === 'github' ? githubMerged(repo, ref.login, day) : gitlabMerged(repo, ref, day)
	);
}

/** Older pulls still establish a profile when the forge user lookup and the recent pull lists found nobody. */
export function historicalAuthor(repo: Repo, ref: PersonRef) {
	const key = JSON.stringify([repo.id, repo.url, ref.login.toLowerCase()]);

	return authors.get(key, async () => {
		if (ref.provider === 'github') {
			const q = `is:pr author:${githubAuthor(ref.login)} repo:${githubSlug(repo)}`;
			const result = record(await github(`search/issues?${new URLSearchParams({ q, per_page: '1' })}`));

			if (!Array.isArray(result.items)) throw new GhError('unknown', 'The GitHub author search was not a list.');

			const user = record(records(result.items)[0]?.user);

			return typeof user.login === 'string' && user.login.toLowerCase() === ref.login.toLowerCase()
				? { author: user.login, authorAvatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null }
				: null;
		}

		const query = new URLSearchParams({ author_username: ref.login, scope: 'all', per_page: '1' });
		const result = await gitlab(`${gitlabProject(repo.url)}/merge_requests?${query}`, ref.host);

		if (!Array.isArray(result)) throw new GhError('unknown', 'The GitLab author search was not an array.');

		const [row] = records(result);
		const pull = row && parseGitlabPullRow(row);

		return pull && pull.author.toLowerCase() === ref.login.toLowerCase()
			? { author: pull.author, authorAvatarUrl: pull.authorAvatarUrl }
			: null;
	});
}

/** Search results are issue rows; fetch full pull data only for the five that the profile displays. */
export function mergedPullEntry(repo: Repo, pull: MergedPull): Promise<PullEntry> {
	if (pull.entry) return Promise.resolve(pull.entry);

	return mergedDetails.get(JSON.stringify([repo.id, repo.url, pull.number]), async () => {
		const row = record(await github(`repos/${githubSlug(repo)}/pulls/${pull.number}`));
		const base = record(row.base);
		const head = record(row.head);

		if (row.number !== pull.number || !row.merged_at) throw new GhError('not-found', 'No merged pull request.');

		return {
			pull: parsePullRow(
				{
					number: row.number,
					title: row.title,
					url: row.html_url,
					author: row.user,
					baseRefName: base.ref,
					headRefName: head.ref,
					headRefOid: head.sha,
					additions: row.additions,
					deletions: row.deletions,
					changedFiles: row.changed_files,
					createdAt: row.created_at,
					body: row.body
				},
				pull.number
			),
			status: {
				state: 'merged',
				draft: row.draft === true,
				mergeability: 'unknown',
				updatedAt: typeof row.updated_at === 'string' ? row.updated_at : pull.mergedAt,
				checks: null,
				commits: typeof row.commits === 'number' ? row.commits : null
			}
		};
	});
}

function githubSlug(repo: Repo): string {
	const slug = parseRepoSlug(repo.url);

	if (!slug.split('/').every((part) => /^[a-z0-9_.-]+$/i.test(part) && part !== '.' && part !== '..')) {
		throw new GhError('unknown', 'Invalid GitHub repository slug.');
	}

	return slug;
}

function githubAuthor(login: string): string {
	return isBotLogin(login) ? `app/${login.slice(0, -5)}` : login;
}

async function githubMerged(repo: Repo, login: string, day: string): Promise<MergedPull[]> {
	const scope = `is:pr is:merged author:${githubAuthor(login)} repo:${githubSlug(repo)} merged:>=${day}`;
	const pulls: MergedPull[] = [];

	for (let page = 1; ; page++) {
		const query = new URLSearchParams({ q: scope, per_page: String(PAGE_SIZE), page: String(page) });
		const result = record(await github(`search/issues?${query}`));

		if (!Array.isArray(result.items) || result.incomplete_results === true || Number(result.total_count) > 1_000)
			throw new GhError('unavailable', 'The GitHub search results were incomplete.');

		for (const row of records(result.items)) {
			const mergedAt = record(row.pull_request).merged_at ?? row.closed_at;

			if (
				typeof row.number === 'number' &&
				Number.isSafeInteger(row.number) &&
				row.number > 0 &&
				typeof mergedAt === 'string'
			)
				pulls.push({ number: row.number, mergedAt });
		}

		if (result.items.length < PAGE_SIZE || page * PAGE_SIZE >= Number(result.total_count)) return pulls;
	}
}

async function gitlabMerged(repo: Repo, ref: PersonRef, day: string): Promise<MergedPull[]> {
	const pulls: MergedPull[] = [];

	const query = new URLSearchParams({
		author_username: ref.login,
		state: 'merged',
		updated_after: `${day}T00:00:00.000Z`,
		order_by: 'updated_at',
		sort: 'desc',
		per_page: String(PAGE_SIZE)
	});

	for (let page = 1; ; page++) {
		query.set('page', String(page));

		const result = await gitlab(`${gitlabProject(repo.url)}/merge_requests?${query}`, ref.host);

		if (!Array.isArray(result)) throw new GhError('unknown', 'The GitLab merge list was not an array.');

		for (const row of records(result)) {
			if (typeof row.merged_at !== 'string') continue;

			const pull = parseGitlabPullRow(row);

			if (pull.number > 0 && pull.author.toLowerCase() === ref.login.toLowerCase())
				pulls.push({ number: pull.number, mergedAt: row.merged_at, entry: gitlabEntry(pull, row) });
		}

		if (result.length < PAGE_SIZE) return pulls;
	}
}
