import type { Repo } from '@recoder/shared';

import { repoKey } from '../connections/repo-input';

/** A pull request someone pasted or typed: its number, and the repository it names, if it names one. */
export interface PullRef {
	number: number;
	/** `host/owner/name` from a link, lowercased. */
	address: string | null;
	/** `name` or `owner/name` typed before `#`, lowercased. */
	name: string | null;
}

/** A link to a pull request (GitHub `/pull/12`) or a merge request (GitLab `/-/merge_requests/12`), with or without a scheme. */
const LINK = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\S+?)\/(?:-\/)?(?:pull|merge_requests)\/(\d+)(?:[/?#]\S*)?$/i;

/** `12`, `#12`, `api#12` or `acme/api#12`. */
const SHORT = /^(?:([\w.-]+(?:\/[\w.-]+)*)#|#)?(\d+)$/;

/** The number as a pull request number: a positive whole number, or null. */
function prNumber(digits: string): number | null {
	const number = Number(digits);

	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** The pull request a link or a short form names, or null when the text names none. */
export function parsePullRef(text: string): PullRef | null {
	const trimmed = text.trim();
	const link = LINK.exec(trimmed);
	const short = link ? null : SHORT.exec(trimmed);
	const number = prNumber(link?.[2] ?? short?.[2] ?? '');

	if (number === null) return null;

	if (link) return { number, address: repoKey(link[1]), name: null };

	return { number, address: null, name: short?.[1]?.toLowerCase() ?? null };
}

/** The `owner/name` a pull request link points into, as written (`group/sub/tool` on GitLab), or null for any other text. */
export function repoFromLink(url: string): string | null {
	const link = LINK.exec(url.trim());

	return link?.[1].split('/').slice(1).join('/') || null;
}

/** True when `path` is the repository's whole name or address, or its last segments. */
function names(repo: Repo, path: string): boolean {
	const key = repoKey(repo.url);
	const name = repo.name.toLowerCase();

	return [key, name].some((own) => own === path || own.endsWith(`/${path}`));
}

/** The tracked repositories the reference can belong to: the one it names, or every one when it names none. */
export function reposFor(ref: PullRef, repos: Repo[]): Repo[] {
	const path = ref.address ?? ref.name;

	return path ? repos.filter((repo) => names(repo, path)) : repos;
}
