import type { SettingsSection } from './sections';

/**
 * The Settings pages' addresses: `/settings/<section>`, one page per section.
 * `?add=provider` on the agent page asks its provider dialog to open.
 */

/** The address of the settings page for `section`, plus any params the page owns. */
export function settingsHref(section: SettingsSection, extra: Record<string, string> = {}): string {
	const params = new URLSearchParams(extra);
	const query = params.toString();

	return `/settings/${section}${query ? `?${query}` : ''}`;
}

/**
 * Goes to Settings on `section`. A full navigation: the section is a page of
 * its own now, not a modal over the page on screen.
 */
export function openSettings(section: SettingsSection = 'agent', extra?: Record<string, string>): void {
	window.location.assign(settingsHref(section, extra));
}

/** Drops one param the settings page owns, keeping the rest of the address: the provider dialog's `add` once it has closed. */
export function dropPageParam(key: string): void {
	const params = new URLSearchParams(window.location.search);

	params.delete(key);

	const query = params.toString();

	window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
}
