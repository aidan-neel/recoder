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

/** The printed label for a key name such as `a`, `Enter` or `mod+k`. */
function keyLabel(key: string, mac = true): string {
	if (key === 'mod') return mac ? '⌘' : 'Ctrl';
	if (key === 'Alt') return mac ? '⌥' : 'Alt';
	if (key.startsWith('mod+')) return `${mac ? '⌘' : 'Ctrl '}${keyLabel(key.slice(4), mac)}`;

	return GLYPHS[key] ?? key.toUpperCase();
}

interface KeycapProps {
	/** The key name, as the key map names it (`a`, `Enter`, `mod+k`, `?`). Presses of it flash this cap. */
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
