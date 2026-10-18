import type { Provider } from '@recoder/shared';

/** A repository to track, read from what someone typed. */
interface RepoTarget {
	name: string;
	url: string;
	provider: Provider;
}

/** The repository the text names, or why it does not name one. */
type RepoInputResult = { ok: true; repo: RepoTarget } | { ok: false; error: string };

/** One path segment of an owner, group or repository name. */
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** `owner/name` with nothing else: a GitHub repository. GitHub owners never hold a dot, so `host/x` is not one. */
const SHORT = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

/** `git@host:path`, the address `git clone` prints for SSH. */
const SCP = /^[\w.-]+@([^:/\s]+):(.+)$/;

const HOSTLESS = 'Enter owner/name or a link to the repository.';

const INVALID = 'That isn’t a repository name.';

function fail(error: string): RepoInputResult {
	return { ok: false, error };
}

/** True for gitlab.com, any `gitlab.` host, and the self-managed host Settings holds. */
function isGitlabHost(host: string, gitlabHost: string | null): boolean {
	return host === gitlabHost || host === 'gitlab.com' || /(^|\.)gitlab\./.test(host);
}

/** The path's segments, without a trailing `.git`, and for GitLab without the `/-/…` page part. */
function pathSegments(pathname: string): string[] {
	const parts = pathname.split('/').filter(Boolean);
	const page = parts.indexOf('-');
	const kept = page === -1 ? parts : parts.slice(0, page);
	const last = kept.length - 1;

	if (last >= 0) kept[last] = kept[last].replace(/\.git$/, '');

	return kept.filter(Boolean);
}

/** A `file://` URL: a git repository on this machine. */
function localRepo(text: string): RepoInputResult {
	const name = text
		.replace(/^file:\/\//i, '')
		.split('/')
		.filter(Boolean)
		.pop();

	if (!name) return fail('That file:// URL has no folder in it.');

	return { ok: true, repo: { name, url: text.replace(/\/+$/, ''), provider: 'local' } };
}

/** The text as a URL: SSH addresses become https, and a bare host gets a scheme. */
function asUrl(text: string): URL | null {
	const scp = SCP.exec(text);
	const href = scp ? `https://${scp[1]}/${scp[2]}` : /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

	try {
		return new URL(href);
	} catch {
		return null;
	}
}

/** True when every segment can be part of a repository path. */
function validPath(segments: string[]): boolean {
	return segments.every((segment) => SEGMENT.test(segment));
}

/** A GitHub repository: the first two segments, whatever page of it the link points at. */
function githubRepo(segments: string[]): RepoInputResult {
	const [owner, name] = segments;

	if (!owner || !name) return fail(HOSTLESS);
	if (!validPath([owner, name])) return fail(INVALID);

	return {
		ok: true,
		repo: { name: `${owner}/${name}`, url: `https://github.com/${owner}/${name}`, provider: 'github' }
	};
}

/** A GitLab project: every segment before the `/-/` page part, subgroups included. */
function gitlabRepo(url: URL, segments: string[]): RepoInputResult {
	if (segments.length < 2) return fail('Enter the group and project, like group/project.');
	if (!validPath(segments)) return fail(INVALID);

	const path = segments.join('/');

	return { ok: true, repo: { name: path, url: `${url.protocol}//${url.host}/${path}`, provider: 'gitlab' } };
}

/**
 * Reads what someone typed into Add by URL: `owner/name` (GitHub), a GitHub
 * or GitLab link to the repository or any page in it, an SSH address, or a
 * `file://` URL. `gitlabHost` is the self-managed GitLab Settings holds.
 */
export function parseRepoInput(raw: string, gitlabHost: string | null = null): RepoInputResult {
	const text = raw.trim();

	if (!text) return fail(HOSTLESS);
	if (/^file:\/\//i.test(text)) return localRepo(text);

	const short = SHORT.exec(text);

	if (short) return githubRepo([short[1], short[2]]);

	const url = asUrl(text);

	if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return fail(HOSTLESS);

	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	const segments = pathSegments(url.pathname);

	if (host === 'github.com') return githubRepo(segments);
	if (isGitlabHost(host, gitlabHost?.toLowerCase() ?? null)) return gitlabRepo(url, segments);

	return fail('Recoder tracks GitHub and GitLab repositories.');
}

/** One key per repository however its URL is written: no scheme, `www.`, `.git` or trailing slash, any case. */
export function repoKey(url: string): string {
	return url
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
		.replace(/^www\./, '')
		.replace(/\/+$/, '')
		.replace(/\.git$/, '');
}
