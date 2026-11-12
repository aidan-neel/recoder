import { StatusNotice } from '@recoder/ui/status-notice';
import type { ReactNode } from 'react';

interface PageNoticeProps {
	/** The sentence that matters, in full ink. */
	lead: ReactNode;
	/** What follows it, in the brief's body color. */
	rest?: ReactNode;
	/** `h2` when the notice sits under a page title, as a settings section does. */
	heading?: 'h1' | 'h2';
	/** Buttons that get the reader out: try again, back to the queue. */
	children?: ReactNode;
}

/**
 * A whole page that cannot show its content: the server is down, the review
 * is gone, nothing is tracked yet. The kit's page notice, in the AI voice in
 * a centred column. It holds no state, so the 404 renders it on the server.
 */
export function PageNotice({ lead, rest, heading = 'h1', children }: PageNoticeProps) {
	return <StatusNotice variant="page" heading={heading} title={lead} detail={rest} actions={children} />;
}
