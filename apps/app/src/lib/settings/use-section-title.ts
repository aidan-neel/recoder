'use client';

import { useEffect, useRef, useState } from 'react';

import { sectionTitle, type SettingsSection } from './sections';

/**
 * Names the browser tab for the open settings section, then gives the page
 * its own name back when the section unmounts, unless the page has renamed
 * it since (a link inside settings went to a review).
 */
export function useSectionTitle(section: SettingsSection): void {
	const [before] = useState(() => document.title);
	const shown = useRef('');

	useEffect(() => {
		shown.current = `${sectionTitle(section)} · Recoder`;
		document.title = shown.current;
	}, [section]);

	useEffect(
		() => () => {
			if (document.title === shown.current) document.title = before;
		},
		[before]
	);
}
