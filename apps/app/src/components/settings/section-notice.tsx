import { Button, StatusNotice, type ButtonStatus } from '@recoder/ui';

import { OFFLINE_TEXT } from '@/lib/api/http';
import { useRetryWhenBack } from '@/lib/api/use-retry-when-back';

interface SectionNoticeProps {
	/** The server's reason when it answered with an error; null when it never answered. */
	error: string | null;
	/** What did not load, for the title: "Settings", "Connections". */
	what: string;
	retry: { status: ButtonStatus; run: () => void };
}

/**
 * A section did not load: the review server is down, or it answered with an error. Try again reads it again, and so
 * does the server answering after it went quiet.
 */
export function SectionNotice({ error, what, retry }: SectionNoticeProps) {
	useRetryWhenBack(retry.run);

	return (
		<div className="page-notice">
			<StatusNotice
				variant="section"
				heading="h2"
				title={error ? `${what} did not load` : OFFLINE_TEXT}
				detail={error ?? 'Recoder tries again by itself once it’s back.'}
				actions={
					<Button status={retry.status} onClick={retry.run}>
						Try again
					</Button>
				}
			/>
		</div>
	);
}
