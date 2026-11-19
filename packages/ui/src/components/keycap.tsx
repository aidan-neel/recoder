'use client';

import { useSyncExternalStore } from 'react';

import { cn } from '../lib/cn';

const GLYPHS: Record<string, string> = {
	Enter: '↵',
	Escape: 'esc',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Backspace: '⌫',
	Tab: 'tab',
	Shift: '⇧',
	PageUp: 'pg up',
	PageDown: 'pg dn',
	Home: 'home',
	End: 'end',
	' ': 'space'
};

/** True on Apple platforms, where the command key is the modifier. */
function isMac(): boolean {
	return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** Reads the platform once on the client; the server and first paint assume a Mac. */
function useMac(): boolean {
	return useSyncExternalStore(
		() => () => {},
		isMac,
		() => true
	);
}

/** The modifiers a key name may start with (`mod+k`, `alt+shift+t`), as a Mac and as other keyboards print them. */
const MODIFIERS: Record<string, { mac: string; other: string }> = {
	mod: { mac: '⌘', other: 'Ctrl ' },
	alt: { mac: '⌥', other: 'Alt ' },
	shift: { mac: '⇧', other: 'Shift ' }
};

/** The printed label for a key name such as `a`, `Enter`, `mod+k` or `alt+shift+t`. */
function keyLabel(key: string, mac = true): string {
	if (key === 'mod') return mac ? '⌘' : 'Ctrl';
	if (key === 'Alt') return mac ? '⌥' : 'Alt';

	const plus = key.indexOf('+', 1);
	const modifier = plus > 0 ? MODIFIERS[key.slice(0, plus)] : undefined;

	if (modifier) return `${mac ? modifier.mac : modifier.other}${keyLabel(key.slice(plus + 1), mac)}`;

	return GLYPHS[key] ?? key.toUpperCase();
}

interface KeycapProps {
	/** The key name, as the key map names it (`a`, `Enter`, `mod+k`, `alt+t`, `?`). Presses of it flash this cap. */
	k: string;
	/**
	 * Hidden from assistive tech by default, so a cap inside a button or a menu
	 * row never joins its name; such a control names its key with
	 * `aria-keyshortcuts`. Pass `false` where the key is the content, as in a
	 * list of shortcuts.
	 */
	'aria-hidden'?: boolean;
	className?: string;
}

/** A small key label. `flashKey` in the app presses every cap whose `data-key` matches a handled key. */
export function Keycap({ k, 'aria-hidden': hidden = true, className }: KeycapProps) {
	const mac = useMac();

	return (
		<kbd data-ui="keycap" data-key={k} aria-hidden={hidden || undefined} className={cn(className)}>
			{keyLabel(k, mac)}
		</kbd>
	);
}
