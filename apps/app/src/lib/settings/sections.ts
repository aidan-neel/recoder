interface SectionInfo {
	id: string;
	label: string;
	/** What the section holds, in the words a person searches for: its groups, rows and what they set. */
	keywords: string;
	/** Only the admin has this section: a member neither sees it in the Settings nav nor can open it. */
	adminOnly?: true;
}

/** The sections of Settings, in the nav's order. The admin's own run last, under the nav's Admin label. */
export const SETTINGS_SECTIONS = [
	{
		id: 'models',
		label: 'Models',
		keywords: 'review model subagent verifier context windows tokens available models show hide effort'
	},
	{
		id: 'providers',
		label: 'Providers',
		keywords: 'model providers agent cli install sign-in binary config api key local servers vllm runtime status'
	},
	{
		id: 'connections',
		label: 'Connections',
		keywords: 'account sign out forges github gitlab token connect disconnect repositories'
	},
	{ id: 'appearance', label: 'Appearance', keywords: 'theme color mode dark light palette typeface font' },
	{
		id: 'admin',
		label: 'Recoder',
		keywords: 'guidelines global mentions handle people members chosen by',
		adminOnly: true
	},
	{
		id: 'server',
		label: 'Server',
		keywords:
			'overview version address https certificate storage database disk checks update release notes branch restart rollback history automatic channel backups restore download logs',
		adminOnly: true
	},
	{
		id: 'limits',
		label: 'Limits',
		keywords: 'effort token budget subagents findings low severity size files diff characters per file',
		adminOnly: true
	},
	{
		id: 'telemetry',
		label: 'Telemetry',
		keywords:
			'pull requests reviewed merged auto reviews findings raised accepted dismissed blocking fixed severity breakdown',
		adminOnly: true
	},
	{
		id: 'usage',
		label: 'Usage',
		keywords: 'tokens sessions cost cache input output model calls failed by kind daily people',
		adminOnly: true
	}
] as const satisfies readonly SectionInfo[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** The sections a person may open: every one for the admin, all but the admin's own for a member. */
export function sectionsFor(admin: boolean): (typeof SETTINGS_SECTIONS)[number][] {
	return SETTINGS_SECTIONS.filter((section) => admin || !('adminOnly' in section));
}

/**
 * The sections whose name or keywords hold every word of `query`, in order; ignoring case and where a word falls. An
 * empty query keeps every section.
 */
export function matchSections<T extends SectionInfo>(sections: readonly T[], query: string): T[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);

	return sections.filter((section) => {
		const text = `${section.label} ${section.keywords}`.toLowerCase();

		return words.every((word) => text.includes(word));
	});
}

/** True when `section` is open to the person: a member has no way into the admin's sections. */
export function canOpenSection(section: SettingsSection, admin: boolean): boolean {
	return sectionsFor(admin).some((item) => item.id === section);
}

/** A section's name, as the Settings nav and its breadcrumb show it: "Limits". */
export function sectionLabel(section: SettingsSection): string {
	return SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? section;
}
