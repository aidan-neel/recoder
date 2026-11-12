import type { Repo } from '@recoder/shared';
import { describeLink } from '@recoder/ui/form';

import { repoKey } from '../connections/repo-input';

/** A pull request someone pasted or typed: its number, and the repository it names, if it names one. */
export interface PullRef {
	number: number;
	/** `host/owner/name` from a link, lowercased. */
	address: string | null;
	/** `name` or `owner/name` typed before `#`, lowercased. */
	name: string | null;
}

/** A scheme at the start of a link. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `12`, `#12`, `api#12` or `acme/api#12`, and GitLab's `!12` or `api!12` for a merge request. */
const SHORT = /^(?:([\w.-]+(?:\/[\w.-]+)*)[#!]|[#!])?(\d+)$/;

/** The number as a pull request number: a positive whole number, or null. */
function prNumber(digits: string): number | null {
	const number = Number(digits);

	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * The pull request a link names, read by the kit's link reader so a link
 * here and its embed agree: GitHub `/pull/12` (or a commit in it), GitLab
 * `/-/merge_requests/12`, with or without a scheme.
 */
function linkRef(text: string): PullRef | null {
	if (/\s/.test(text) || !text.includes('/')) return null;

	const link = describeLink(SCHEME.test(text) ? text.replace(SCHEME, 'https://') : `https://${text}`);
	const names = link.kind === 'pull' || link.kind === 'commit';

	if (!names || link.address === null || link.number === null) return null;

	return { number: link.number, address: link.address, name: null };
}

/** The pull request a link or a short form names, or null when the text names none. */
export function parsePullRef(text: string): PullRef | null {
	const trimmed = text.trim();
	const link = linkRef(trimmed);

	if (link) return link;

	const short = SHORT.exec(trimmed);
	const number = prNumber(short?.[2] ?? '');

	if (number === null) return null;

	return { number, address: null, name: short?.[1]?.toLowerCase() ?? null };
}

/** True when `path` is the repository's whole name or address, or its last segments. */
function names(repo: Pick<Repo, 'url' | 'name'>, path: string): boolean {
	const key = repoKey(repo.url);
	const name = repo.name.toLowerCase();

	return [key, name].some((own) => own === path || own.endsWith(`/${path}`));
}

/** True when the reference can belong to the repository: it names this one, or names none. */
function refNames(ref: PullRef, repo: Pick<Repo, 'url' | 'name'>): boolean {
	const path = ref.address ?? ref.name;

	return !path || names(repo, path);
}

/** The tracked repositories the reference can belong to: the one it names, or every one when it names none. */
export function reposFor(ref: PullRef, repos: Repo[]): Repo[] {
	return repos.filter((repo) => refNames(ref, repo));
}
