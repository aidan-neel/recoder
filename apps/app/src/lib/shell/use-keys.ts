'use client';

import { useEffect, useRef } from 'react';

import { listenKeys, type KeyMap } from './keys';

/**
 * Binds page shortcuts while the component is mounted. The map is rebuilt on
 * every render and read on every press, so handlers always see current state.
 */
export function useKeys(map: KeyMap): void {
	const latest = useRef(map);

	useEffect(() => {
		latest.current = map;
	});

	useEffect(() => listenKeys(() => latest.current), []);
}
