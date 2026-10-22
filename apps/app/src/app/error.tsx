'use client';

import { Button } from '@recoder/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { useQueue } from '@/lib/queue/queue-store';
import { activeTab, QUEUE_TAB, queueHref } from '@/lib/shell/routes';

interface ErrorProps {
	error: unknown;
	/** Fetches and renders the page again. */
	retry: () => void;
}

/**
 * A page that broke while rendering. It shows inside the shell, so the top
 * bar, the tabs and anything saved in this browser stay; Try again renders
 * the page again. When the queue broke, the list it rendered is dropped, so
 * the queue loads it again instead of breaking on the same rows; on the queue
 * itself there is no link back to it.
 */
export default function PageError({ retry }: ErrorProps) {
	const pathname = usePathname();
	const onQueue = activeTab(pathname) === QUEUE_TAB;

	useEffect(() => {
		if (onQueue) useQueue.getState().reset();
	}, [onQueue]);

	return (
		<PageNotice lead="This page hit an error.">
			<Button variant="primary" onClick={retry}>
				Try again
			</Button>
			{onQueue ? null : (
				<Button asChild variant="outline">
					<Link href={queueHref(pathname)}>Back to the queue</Link>
				</Button>
			)}
		</PageNotice>
	);
}
