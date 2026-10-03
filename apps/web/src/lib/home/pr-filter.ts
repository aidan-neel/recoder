import type { PullRequest, Repo } from '@recoder/shared';

/** What the Home filter box holds, parsed once per keystroke. */
interface PrFilter {
	/** Trimmed, lowercased filter text. */
	query: string;
	/** True when the text is a pasted URL; then only that exact pull request matches. */
	isUrl: boolean;
	pastedNumber: number | null;
	pastedRepo: Repo | undefined;
}

/** A pull request number from `#12`, `12`, or a pull/merge request URL. */
export function parsePrNumber(text: string): number | null {
	const trimmed = text.trim();

	if (trimmed === '') return null;

	const url = trimmed.match(/(?:pull|merge_requests)\/(\d+)/i);
	const digits = (url?.[1] ?? (/^#?\d+$/.test(trimmed) ? trimmed : '')).replace(/\D/g, '');

	if (digits === '') return null;

	const n = Number.parseInt(digits, 10);

	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The tracked repo a pasted PR belongs to (URL match), else the chosen repo, else the first. */
export function repoForPaste(text: string, repos: Repo[], chosen: Repo | undefined): Repo | undefined {
	const url = text.match(/(?:github|gitlab)\.com\/([^/\s]+)\/([^/\s#?]+)/i);

	if (url) {
		const slug = `${url[1]}/${url[2]}`.toLowerCase();

		return repos.find((r) => r.name.toLowerCase() === slug || r.url.toLowerCase().includes(slug));
	}

	return chosen ?? repos[0];
}

/** True when the pull request matches the filter by repo, number, title, branch or author. */
export function matchesPr(pr: PullRequest, repo: Repo, filter: PrFilter): boolean {
	const { query } = filter;

	if (query === '') return true;
	if (filter.isUrl) return pr.number === filter.pastedNumber && filter.pastedRepo?.id === repo.id;

	return (
		repo.name.toLowerCase().includes(query) ||
		`#${pr.number}`.includes(query) ||
		String(pr.number).includes(query) ||
		pr.title.toLowerCase().includes(query) ||
		pr.headRef.toLowerCase().includes(query) ||
		pr.author.toLowerCase().includes(query)
	);
}
