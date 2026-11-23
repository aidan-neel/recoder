import type { PersonRef } from '@recoder/shared';

import { PULL_TABS, type PullTab } from '../pull/types';
import { serverViewOf, type ServerView } from '../server/server-views';
import { SETTINGS_SECTIONS, sectionLabel, type SettingsSection } from '../settings/sections';
import { displayName } from '../people/refs';

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

/**
 * True for the live app. The sample has no Automations, Guidelines or Settings of its own, so its shell leaves
 * them out instead of sending a visitor to the live pages and their sign-in.
 */
export function isLiveApp(base: string): boolean {
	return base === '';
}

/** The pull request list. */
export function pullsHref(base: string): string {
	return base || '/';
}

/** A pull request's page, on `tab` when one is given; without one it lands where the page decides. */
export function pullHref(base: string, repoId: string, number: number, tab?: PullTab): string {
	const path = `${base}/pulls/${encodeURIComponent(repoId)}/${number}`;

	return tab ? `${path}?tab=${tab}` : path;
}

/** Old names of tabs that still open them: the Review tab was the Bugs tab, and the Description tab the Summary tab. */
const PULL_TAB_ALIASES: ReadonlyMap<string, PullTab> = new Map([
	['bugs', 'review'],
	['summary', 'description']
]);

/** The tab a pull request address names (`?tab=review`); null when it names none or one the page does not have. */
export function pullTabOf(value: string | null): PullTab | null {
	const tab = PULL_TABS.find((candidate) => candidate === value);

	return tab ?? PULL_TAB_ALIASES.get(value ?? '') ?? null;
}

/** The tracked repositories, with a way to add more. */
export function reposHref(base: string): string {
	return `${base}/repos`;
}

/** The Repositories page with its Add repository dialog open. */
export function addRepoHref(base: string): string {
	return `${reposHref(base)}?add`;
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

/** A section of Settings, which opens in the tab on screen; live only. The first section when none is named. */
export function settingsHref(section: SettingsSection = SETTINGS_SECTIONS[0].id, view?: ServerView): string {
	return view ? `/settings/${section}/${view}` : `/settings/${section}`;
}

/** True for an address of Settings, whose sections take over the sidebar. */
export function inSettings(pathname: string): boolean {
	return pathname === '/settings' || pathname.startsWith('/settings/');
}

/** The section an address of Settings names, or null for one Settings does not have. */
function sectionOf(id: string | undefined): SettingsSection | null {
	return SETTINGS_SECTIONS.find((section) => section.id === (id ?? SETTINGS_SECTIONS[0].id))?.id ?? null;
}

/** The screen an address opens, with the parts of the address that screen reads. */
export type Route =
	| { screen: 'pulls' | 'new' | 'repos' | 'automations' | 'guidelines' | 'missing' }
	| { screen: 'repo'; repoId: string }
	| { screen: 'pull'; repoId: string; number: number }
	| { screen: 'chat'; chatId: string }
	| { screen: 'person'; person: PersonRef }
	| { screen: 'review'; reviewId: string }
	| { screen: 'settings'; section: SettingsSection; view: ServerView | null };

/** A pull request number as an address writes it: digits, and never zero. */
const PULL_NUMBER = /^[1-9]\d*$/;

/** The parts of a path after `base`, decoded; null for a path outside `base` or one that does not decode. */
function partsOf(pathname: string, base: string): string[] | null {
	if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;

	try {
		return pathname.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent);
	} catch {
		return null;
	}
}

/** The screen the parts name; `live` adds the pages the sample does not have. */
function screenOf(parts: string[], live: boolean): Route | null {
	const [place = '', first, second] = parts;

	switch (`${place}/${parts.length}`) {
		case '/0':
			return { screen: 'pulls' };
		case 'new/1':
			return { screen: 'new' };
		case 'repos/1':
			return { screen: 'repos' };
		case 'repos/2':
			return { screen: 'repo', repoId: first };
		case 'pulls/3':
			return PULL_NUMBER.test(second) ? { screen: 'pull', repoId: first, number: Number(second) } : null;
		case 'chats/2':
			return { screen: 'chat', chatId: first };
		case 'people/3':
			return first === 'github' || first === 'gitlab'
				? { screen: 'person', person: { provider: first, host: null, login: second } }
				: null;
		case 'people/4':
			return first === 'gitlab'
				? { screen: 'person', person: { provider: first, host: second, login: parts[3] } }
				: null;
		case 'review/2':
			return live ? { screen: 'review', reviewId: first } : null;
		case 'automations/1':
			return live ? { screen: 'automations' } : null;
		case 'guidelines/1':
			return live ? { screen: 'guidelines' } : null;
		case 'settings/1':
		case 'settings/2':
			return live ? settingsRoute(sectionOf(first)) : null;
		case 'settings/3':
			return live && first === 'server' ? settingsRoute('server', second) : null;
		default:
			return null;
	}
}

/** The Settings screen on `section`, and on Server one of its views; null for a section or view Settings does not have. */
function settingsRoute(section: SettingsSection | null, viewId?: string): Route | null {
	if (!section) return null;
	if (section !== 'server') return { screen: 'settings', section, view: null };

	const view = serverViewOf(viewId);

	return view ? { screen: 'settings', section, view } : null;
}

/**
 * The screen a path opens under `base`. Every address is read here, in the
 * browser, so a page change needs no server; a path that names no screen is
 * the missing page.
 */
export function routeOf(pathname: string, base: string): Route {
	const parts = partsOf(pathname, base);

	return (parts && screenOf(parts, isLiveApp(base))) ?? { screen: 'missing' };
}

/** What the browser tab says for a screen, before the app's name. */
export function titleOf(route: Route): string {
	switch (route.screen) {
		case 'pulls':
			return 'Pull requests';
		case 'new':
			return 'New review';
		case 'repos':
			return 'Repositories';
		case 'repo':
			return 'Repository';
		case 'pull':
			return `#${route.number}`;
		case 'chat':
			return 'Chat';
		case 'person':
			return displayName(route.person);
		case 'review':
			return 'Review';
		case 'automations':
			return 'Automations';
		case 'guidelines':
			return 'Guidelines';
		case 'settings':
			return sectionLabel(route.section);
		case 'missing':
			return 'Not found';
	}
}
