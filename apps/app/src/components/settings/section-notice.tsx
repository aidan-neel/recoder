import { Button, StatusNotice, type ButtonStatus } from '@recoder/ui';

import { OFFLINE_TEXT } from '@/lib/api/http';

interface SectionNoticeProps {
	/** The server's reason when it answered with an error; null when it never answered. */
	error: string | null;
	/** What did not load, for the title: "Settings", "Connections". */
	what: string;
	retry: { status: ButtonStatus; run: () => void };
}

/** A section did not load: the review server is down, or it answered with an error. Try again reads it again. */
export function SectionNotice({ error, what, retry }: SectionNoticeProps) {
	return (
		<div className="page-notice">
			<StatusNotice
				variant="section"
				heading="h2"
				title={error ? `${what} did not load` : OFFLINE_TEXT}
				detail={error ?? 'Start it, then try again.'}
				actions={
					<Button status={retry.status} onClick={retry.run}>
						Try again
					</Button>
				}
			/>
		</div>
	);
}
