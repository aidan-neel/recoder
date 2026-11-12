'use client';

import { Button } from '@recoder/ui/button';
import { StatusNotice } from '@recoder/ui/status-notice';

import { useReview } from '@/lib/review/review-store';

function reconnect(): void {
	useReview.getState().reconnect();
}

/**
 * In place of a live view whose first snapshot never came: what did not
 * load and Try again, which reconnects the stream and puts the placeholder
 * back while it waits. The stream keeps retrying on its own meanwhile.
 * `className` sizes it to the view it stands in for.
 */
export function StreamFailed({ what, className = 'pane-notice' }: { what: string; className?: string }) {
	return (
		<StatusNotice
			tone="danger"
			title={`${what} didn’t load.`}
			detail="The review server’s live updates aren’t coming through."
			actions={<Button onClick={reconnect}>Try again</Button>}
			className={className}
		/>
	);
}
