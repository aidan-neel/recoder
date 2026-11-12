'use client';

import { useState } from 'react';

/**
 * True from the first render a menu is open, for good. Menu content builds
 * nothing until then, so a page of closed menus (a right-click region per
 * row) mounts no presence each, and it stays built after, so it can animate
 * out. The state is set during render once, the first time the menu opens.
 */
export function useOpened(open: boolean): boolean {
	const [opened, setOpened] = useState(open);

	if (open && !opened) setOpened(true);

	return opened || open;
}
