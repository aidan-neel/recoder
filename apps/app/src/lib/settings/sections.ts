interface SectionInfo {
	id: string;
	label: string;
	/** Only the admin has this section: a member neither sees it in the sidebar nor can open its address. */
	adminOnly?: true;
}

/** The sections of Settings, in the sidebar's order. Each is a page: `/settings/<id>`. */
export const SETTINGS_SECTIONS = [
	{ id: 'models', label: 'Models' },
	{ id: 'providers', label: 'Providers' },
	{ id: 'connections', label: 'Connections' },
	{ id: 'limits', label: 'Review limits' },
	{ id: 'usage', label: 'Usage', adminOnly: true },
	{ id: 'admin', label: 'Admin', adminOnly: true },
	{ id: 'appearance', label: 'Appearance' }
] as const satisfies readonly SectionInfo[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** The sections a person may open: every one for the admin, all but the admin's own for a member. */
export function sectionsFor(admin: boolean): (typeof SETTINGS_SECTIONS)[number][] {
	return SETTINGS_SECTIONS.filter((section) => admin || !('adminOnly' in section));
}

/** True when `section` is open to the person: a member has no way into the admin's sections. */
export function canOpenSection(section: SettingsSection, admin: boolean): boolean {
	return sectionsFor(admin).some((item) => item.id === section);
}

/** True for a known section id. */
export function isSettingsSection(value: string): value is SettingsSection {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/** A section's name, as the sidebar and the top of its page show it: "Review limits". */
export function sectionLabel(section: SettingsSection): string {
	return SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? section;
}

/** What a section's browser tab is called, before the app's " · Recoder": "Connections settings". */
export function sectionTitle(section: SettingsSection): string {
	return `${sectionLabel(section)} settings`;
}

/** The section an address shows (`/settings/limits` → `limits`), or null off Settings or on an unknown one. */
export function sectionOfPath(pathname: string): SettingsSection | null {
	const [, root, section] = pathname.split('/');

	return root === 'settings' && section && isSettingsSection(section) ? section : null;
}
