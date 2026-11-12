'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { BackToQueue, ErrorNotice } from '@/components/shell/error-notice';
import { useQueue } from '@/lib/queue/queue-store';
import { activeTab, QUEUE_TAB } from '@/lib/shell/routes';

interface ErrorProps {
	error: unknown;
	/** Fetches and renders the page again. */
	retry: () => void;
}

/**
 * A page that broke while rendering, which says so apart from a load that
 * failed (each page shows those in place). It shows inside the shell, so the
 * top bar, the tabs and anything saved in this browser stay. Rendering the
 * same data again breaks the same way, so the page offers Reload and the way
 * back to the queue. The queue is the exception: the list it rendered is
 * dropped, so Try again loads it fresh instead of breaking on the same rows.
 */
export default function PageError({ error, retry }: ErrorProps) {
	const pathname = usePathname();
	const onQueue = activeTab(pathname) === QUEUE_TAB;

	useEffect(() => {
		if (onQueue) useQueue.getState().reset();
	}, [onQueue]);

	return (
		<ErrorNotice error={error} retry={onQueue ? retry : undefined} lead="This page couldn’t be shown.">
			<BackToQueue pathname={pathname} />
		</ErrorNotice>
	);
}
