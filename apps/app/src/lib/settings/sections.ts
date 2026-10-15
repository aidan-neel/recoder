import Bot from '@lucide/svelte/icons/bot';
import BookText from '@lucide/svelte/icons/book-text';
import Cable from '@lucide/svelte/icons/cable';
import Gauge from '@lucide/svelte/icons/gauge';
import SunMoon from '@lucide/svelte/icons/sun-moon';
import type { Component } from 'svelte';
import { SETTINGS_SECTIONS, type SettingsSection } from '$web/settings/model-settings.svelte';

/** A settings section as this app shows it: apps/web's id and name, with an icon and search words. */
interface SectionLink {
	id: SettingsSection;
	label: string;
	icon: Component;
	/** What the section holds, so search finds it by a setting's name. */
	keywords: string;
}

const EXTRA: Record<SettingsSection, Omit<SectionLink, 'id' | 'label'>> = {
	models: { icon: Bot, keywords: 'model review subagent verifier cli provider opencode claude codex devin effort' },
	connections: { icon: Cable, keywords: 'github gitlab token git repository track' },
	harness: { icon: Gauge, keywords: 'subagents low severity findings limits files diff characters' },
	guidelines: { icon: BookText, keywords: 'rules review.md conventions global repository' },
	appearance: { icon: SunMoon, keywords: 'theme dark light system display' }
};

export const SECTIONS: SectionLink[] = SETTINGS_SECTIONS.map((section) => ({ ...section, ...EXTRA[section.id] }));

/** Sections whose name or contents mention every word typed. */
export function searchSections(query: string): SectionLink[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);

	return SECTIONS.filter((section) => {
		const text = `${section.label} ${section.keywords}`.toLowerCase();

		return words.every((word) => text.includes(word));
	});
}
