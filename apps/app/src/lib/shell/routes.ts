import type { PullTab } from '../pull/types';
import { SETTINGS_SECTIONS, type SettingsSection } from '../settings/sections';

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

/** A chat with Recoder about a repository. */
export function chatHref(base: string, chatId: string): string {
	return `${base}/chats/${encodeURIComponent(chatId)}`;
}

/** Where Settings' pages live. */
const SETTINGS_ROOT = '/settings';

/**
 * Settings on `section`, or on its first section. Opening Settings goes
 * straight there, so the sidebar's swap lands on an open section row instead
 * of waiting for a redirect. Live only.
 */
export function settingsHref(section: SettingsSection = SETTINGS_SECTIONS[0].id): string {
	return `${SETTINGS_ROOT}/${section}`;
}

/** True on Settings or one of its sections, where the sidebar lists the sections instead of the app's places. */
export function isSettingsPath(pathname: string): boolean {
	return pathname === SETTINGS_ROOT || pathname.startsWith(`${SETTINGS_ROOT}/`);
}
