import type { PullTab } from '../pull/types';
import type { SettingsSection } from '../settings/sections';

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

/** The New review screen. */
export function newReviewHref(base: string): string {
	return `${base}/new`;
}

/**
 * Settings, on one section when given, plus any params that page owns
 * (`add=provider` asks the Models page to open its provider dialog). Live only.
 */
export function settingsHref(section?: SettingsSection, extra: Record<string, string> = {}): string {
	const query = new URLSearchParams(extra).toString();
	const path = section ? `/settings/${section}` : '/settings';

	return query ? `${path}?${query}` : path;
}
