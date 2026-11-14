import { withoutTransitions } from '@recoder/shared';

import { readStored, writeStored } from '../shell/browser-storage';

/**
 * The palette and the typeface: picked in Settings → Appearance, saved in
 * this browser, and shown as an attribute on <html> that the CSS keys on
 * (`styles/palettes.css`, `styles/appearance.css`). The fallback of each sets
 * no attribute, so the app's own tokens show.
 */
export interface RootChoice<Id extends string> {
	/** Where the pick is saved in localStorage. */
	key: string;
	/** The attribute on <html> the CSS keys on. */
	attribute: string;
	/** Every pick, in the order the picker shows them. */
	options: readonly { id: Id; name: string }[];
	/** The pick when nothing valid is saved. It sets no attribute. */
	fallback: Id;
}

const PALETTE_OPTIONS = [
	{ id: 'graphite', name: 'Graphite' },
	{ id: 'neutral', name: 'Neutral' },
	{ id: 'blue', name: 'Blue' },
	{ id: 'cobalt', name: 'Cobalt' },
	{ id: 'stone', name: 'Stone' },
	{ id: 'pine', name: 'Pine' },
	{ id: 'teal', name: 'Teal' },
	{ id: 'violet', name: 'Violet' },
	{ id: 'ember', name: 'Ember' },
	{ id: 'rose', name: 'Rose' }
] as const;

export type PaletteId = (typeof PALETTE_OPTIONS)[number]['id'];

/** The colours of surfaces, lines, text and the primary. Severity colours stay the same in every palette. */
export const PALETTE: RootChoice<PaletteId> = {
	key: 'recoder-palette',
	attribute: 'data-palette',
	options: PALETTE_OPTIONS,
	fallback: 'graphite'
};

const TYPEFACE_OPTIONS = [
	{ id: 'inter', name: 'Inter' },
	{ id: 'geist', name: 'Geist' }
] as const;

export type TypefaceId = (typeof TYPEFACE_OPTIONS)[number]['id'];

/** The interface face. Code stays Geist Mono in both. */
export const TYPEFACE: RootChoice<TypefaceId> = {
	key: 'recoder-font',
	attribute: 'data-font',
	options: TYPEFACE_OPTIONS,
	fallback: 'inter'
};

/** The saved pick, or the fallback when nothing valid is saved or storage is blocked. */
export function readChoice<Id extends string>(choice: RootChoice<Id>): Id {
	const saved = readStored(choice.key);

	return choice.options.find((option) => option.id === saved)?.id ?? choice.fallback;
}

/** Saves a pick and shows it on <html> in one frame, with no fade. */
export function saveChoice<Id extends string>(choice: RootChoice<Id>, id: Id): void {
	writeStored(choice.key, id);
	withoutTransitions(() => showChoice(choice, id));
}

/** Sets the attribute for a pick, or removes it for the fallback. */
function showChoice<Id extends string>(choice: RootChoice<Id>, id: Id): void {
	const root = document.documentElement;

	if (id === choice.fallback) root.removeAttribute(choice.attribute);
	else root.setAttribute(choice.attribute, id);
}
