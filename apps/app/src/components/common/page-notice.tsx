import type { ReactNode } from 'react';

import { Brief } from './brief';

interface PageNoticeProps {
	lead: ReactNode;
	rest?: ReactNode;
	/** `h2` when the notice sits under a page title, as a settings section does. */
	heading?: 'h1' | 'h2';
	/** Buttons that get the reader out: try again, back to the queue. */
	children?: ReactNode;
}

/** A whole page that cannot show its content: the server is down, the review is gone, nothing is tracked yet. */
export function PageNotice({ lead, rest, heading = 'h1', children }: PageNoticeProps) {
	return (
		<div data-ui="page-notice" className="page-notice">
			<Brief as={heading} lead={lead} rest={rest} />
			{children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
		</div>
	);
}
