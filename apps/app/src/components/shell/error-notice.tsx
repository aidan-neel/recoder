'use client';

import { Button } from '@recoder/ui/button';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { isChunkError, LOST_CHUNK_TEXT } from '@/lib/shell/chunk-reload';
import { activeTab, QUEUE_TAB, queueHref } from '@/lib/shell/routes';
import { useChunkReload } from '@/lib/shell/use-chunk-reload';

interface ErrorNoticeProps {
	/**
	 * What React caught. Left out where nothing was thrown (a page whose
	 * script never came), so the notice never reloads by itself.
	 */
	error?: unknown;
	/** Renders the broken part again. Left out where a second render would break the same way, so Reload leads. */
	retry?: () => void;
	/** What broke, for a fault in the code; a script that failed to load always says so instead. */
	lead: ReactNode;
	rest?: ReactNode;
	/** A further way out, after Try again and Reload. */
	children?: ReactNode;
}

function reload(): void {
	window.location.reload();
}

/**
 * What an error boundary shows: what broke, Try again (render it again) when
 * that can help, and Reload (load the whole page fresh). A lost chunk React
 * caught reloads the page once by itself, and the notice says so while it
 * does; when it cannot reload again, it still says a part did not load, so
 * it never reads as a fault in the page.
 */
export function ErrorNotice({ error, retry, lead, rest, children }: ErrorNoticeProps) {
	const reloading = useChunkReload(error);

	if (reloading) return <PageNotice lead={LOST_CHUNK_TEXT} rest="Reloading the page…" />;

	return (
		<PageNotice lead={isChunkError(error) ? LOST_CHUNK_TEXT : lead} rest={rest}>
			{retry ? (
				<Button variant="primary" onClick={retry}>
					Try again
				</Button>
			) : null}
			<Button variant={retry ? 'outline' : 'primary'} onClick={reload}>
				Reload
			</Button>
			{children}
		</PageNotice>
	);
}

interface BackToQueueProps {
	/** The address on screen, which picks the queue to go back to (the sample keeps its own). */
	pathname: string;
	/** A plain link that loads the queue fresh, for a notice that stands where the router went down. */
	plain?: boolean;
}

/** An error notice's way back to the queue, after Reload. The queue's own notice has none. */
export function BackToQueue({ pathname, plain = false }: BackToQueueProps) {
	if (activeTab(pathname) === QUEUE_TAB) return null;

	const href = queueHref(pathname);

	return (
		<Button asChild variant="outline">
			{plain ? <a href={href}>Back to the queue</a> : <Link href={href}>Back to the queue</Link>}
		</Button>
	);
}
