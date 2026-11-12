'use client';

import { Activity, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

import { LOST_CHUNK_TEXT } from '@/lib/shell/chunk-reload';
import { lateArrival, useShell } from '@/lib/shell/shell-store';
import { clearBootNotice, watchStuckRoute } from '@/lib/shell/stuck-route';

import { BackToQueue, ErrorNotice } from './error-notice';

/**
 * The page, or a notice in its place when its code never arrived: the page
 * the app loaded on lost a script before the app mounted, and its skeleton
 * is still up with nothing coming to replace it (`watchStuckRoute`). The
 * notice offers Reload and the way back to the queue, and never reloads by
 * itself: a slow page must not send the person away, and a page that lost a
 * script React saw reloads through its own error notice instead. It takes
 * the place of the boot watchdog's notice in the same frame. The page stays
 * mounted but hidden under it, so if its code does arrive, the page shows
 * the moment it renders. Going elsewhere drops the notice; coming back to
 * the page while it still waits shows it again.
 */
export function LostPage({ children }: { children: ReactNode }) {
	const shown = useShell((state) => lateArrival(state) ?? state.pathname);
	const [stuckAt, setStuckAt] = useState<string | null>(null);

	if (stuckAt !== null && stuckAt !== shown) setStuckAt(null);

	const stuck = stuckAt === shown;

	useEffect(() => watchStuckRoute(setStuckAt), []);

	useLayoutEffect(() => {
		if (stuck) clearBootNotice();
	}, [stuck]);

	return (
		<>
			<Activity mode={stuck ? 'hidden' : 'visible'}>{children}</Activity>
			{stuck ? (
				<ErrorNotice lead={LOST_CHUNK_TEXT}>
					<BackToQueue pathname={shown} />
				</ErrorNotice>
			) : null}
		</>
	);
}
