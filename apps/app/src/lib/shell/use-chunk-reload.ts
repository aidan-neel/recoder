'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { reloadDue, reloadForChunk } from './chunk-reload';

/**
 * Reloads the page once when the error is a lost chunk (the dev server
 * restarted, or a new build replaced the page's files), which a fresh page
 * loads again. True while that reload is under way, so the error page can say
 * so instead of offering buttons that are about to go. The reload runs after
 * the render that says so; when it cannot run (the tab's storage refuses the
 * mark that stops a reload loop), it turns false, and the buttons come back.
 * Each error gets one try, kept in a ref: React's strict mode runs the effect
 * twice in dev, and a second try would find the first one's mark and read it
 * as a refusal while the reload is on its way.
 */
export function useChunkReload(error: unknown): boolean {
	const due = useMemo(() => typeof window !== 'undefined' && reloadDue(error), [error]);
	const [refused, setRefused] = useState<unknown>(null);
	const tried = useRef<unknown>(null);

	useEffect(() => {
		if (!due || tried.current === error) return;

		tried.current = error;

		/* eslint-disable-next-line react-hooks/set-state-in-effect -- whether the reload ran is known only once it has been tried */
		if (!reloadForChunk(error)) setRefused(error);
	}, [due, error]);

	return due && refused !== error;
}
