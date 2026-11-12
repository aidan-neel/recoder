import { Button, StatusNotice } from '@recoder/ui';

import { OFFLINE_TEXT } from '@/lib/api/http';

/** The review server does not answer: say so, and offer to ask it again. */
export function OfflineNotice({ onRetry }: { onRetry: () => void }) {
	return (
		<StatusNotice
			tone="danger"
			title={OFFLINE_TEXT}
			detail="Start it, then try again."
			actions={<Button onClick={onRetry}>Try again</Button>}
		/>
	);
}
