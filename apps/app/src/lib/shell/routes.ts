import { PULL_TABS, type PullTab } from '../pull/types';

/**
 * Page addresses. Each takes the client's `base` (`''` live, `'/sample'` for
 * the sample), so a link never leaves the sample for the live app.
 */

/** The automations page; live only. */
export const AUTOMATIONS_HREF = '/automations';

/** The review guidelines page; live only. */
export const GUIDELINES_HREF = '/guidelines';

/** The sample: the same screens answered from memory, for a first look with nothing connected. */
export const SAMPLE_HREF = '/sample';

/** The pull request list. */
export function pullsHref(base: string): string {
	return base || '/';
}

/** A pull request's page, on `tab` when it is not the default Changes tab. */
export function pullHref(base: string, repoId: string, number: number, tab?: PullTab): string {
	const path = `${base}/pulls/${encodeURIComponent(repoId)}/${number}`;

	return tab && tab !== 'changes' ? `${path}?tab=${tab}` : path;
}

/** Old names of tabs that still open them: the Review tab was the Bugs tab. */
const PULL_TAB_ALIASES: ReadonlyMap<string, PullTab> = new Map([['bugs', 'review']]);

/** The tab a pull request address names (`?tab=review`); Changes when it names none or one the page does not have. */
export function pullTabOf(value: string | null): PullTab {
	const tab = PULL_TABS.find((candidate) => candidate === value);

	return tab ?? PULL_TAB_ALIASES.get(value ?? '') ?? 'changes';
}

/** The tracked repositories, with a way to add more. */
export function reposHref(base: string): string {
	return `${base}/repos`;
}

/** A tracked repository's page: what needs a person there, and how its reviews have gone. */
export function repoHref(base: string, repoId: string): string {
	return `${base}/repos/${encodeURIComponent(repoId)}`;
}

/** The New review screen. */
export function newReviewHref(base: string): string {
	return `${base}/new`;
}

/** A chat with Recoder about a repository. */
export function chatHref(base: string, chatId: string): string {
	return `${base}/chats/${encodeURIComponent(chatId)}`;
}
