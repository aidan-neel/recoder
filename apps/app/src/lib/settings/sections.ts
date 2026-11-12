/** The sections of Settings, in nav order. Each is a page: `/settings/<id>`. */
export const SETTINGS_SECTIONS = [
	{ id: 'agent', label: 'Agent' },
	{ id: 'connections', label: 'Connections' },
	{ id: 'auto-review', label: 'Auto-review' },
	{ id: 'harness', label: 'Review harness' },
	{ id: 'guidelines', label: 'Guidelines' },
	{ id: 'appearance', label: 'Appearance' }
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** True for a known section id. */
export function isSettingsSection(value: string): value is SettingsSection {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/** What a section's browser tab is called, before the app's " · Recoder": "Connections settings". */
export function sectionTitle(section: SettingsSection): string {
	return `${SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? section} settings`;
}
