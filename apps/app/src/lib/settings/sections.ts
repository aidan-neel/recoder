/** The sections of Settings, in nav order. Each has its own URL: `/settings/<id>`. */
export const SETTINGS_SECTIONS = [
	{ id: 'agent', label: 'Agent' },
	{ id: 'connections', label: 'Connections' },
	{ id: 'harness', label: 'Review harness' },
	{ id: 'guidelines', label: 'Guidelines' },
	{ id: 'appearance', label: 'Appearance' }
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** The section `/settings` itself shows, on its own address, so opening Settings needs no redirect. */
export const DEFAULT_SECTION: SettingsSection = 'agent';

/** True for a known section id. */
export function isSettingsSection(value: string): value is SettingsSection {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/** The section a `/settings/<id>` path shows, {@link DEFAULT_SECTION} for `/settings`, or null for any other path. */
export function sectionFromPath(pathname: string): SettingsSection | null {
	const match = /^\/settings(?:\/([^/?#]*))?(?:[/?#]|$)/.exec(pathname);

	if (!match) return null;

	const id = match[1] || DEFAULT_SECTION;

	return isSettingsSection(id) ? id : null;
}

/** What a section's browser tab is called, before the app's " · Recoder": "Connections settings". */
export function sectionTitle(section: SettingsSection): string {
	return `${SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? section} settings`;
}
