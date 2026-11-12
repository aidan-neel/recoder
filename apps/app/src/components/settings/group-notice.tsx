'use client';

import { Button, StatusNotice, type ButtonVariant } from '@recoder/ui';

import { OFFLINE_DETAIL, OFFLINE_TEXT } from '@/lib/api/http';
import { useAction } from '@/lib/shell/use-action';

import { SettingsGroup } from './settings-group';

/** Loads again. It rejects when the load still failed, so the button shows the failure for a moment. */
type Retry = () => Promise<unknown>;

/** Try again: pending while the load runs, then gone with the notice, or a short failure face when it failed again. */
export function TryAgain({ retry, variant }: { retry: Retry; variant?: ButtonVariant }) {
	const action = useAction();

	return (
		<Button variant={variant} status={action.status} onClick={() => action.run(retry)}>
			Try again
		</Button>
	);
}

interface FailedRowProps {
	/** What failed, in a few words with a full stop: "Couldn’t load the models." */
	what: string;
	/** The server's reason; null when it never answered. */
	reason: string | null;
	retry: Retry;
}

/** What failed and why, with Try again at the right, in one settings row. */
export function FailedRow({ what, reason, retry }: FailedRowProps) {
	return (
		<div className="settings-row">
			<StatusNotice
				variant="inline"
				tone="danger"
				title={what}
				detail={reason ?? OFFLINE_TEXT}
				actions={<TryAgain retry={retry} variant="outline" />}
				className="settings-notice"
			/>
		</div>
	);
}

/**
 * A group whose first load failed: what failed and why in place of its rows,
 * with Try again. The rest of the section still shows what did load.
 */
export function FailedGroup({ title, ...row }: FailedRowProps & { title: string }) {
	return (
		<SettingsGroup title={title}>
			<FailedRow {...row} />
		</SettingsGroup>
	);
}

interface SectionNoticeProps {
	/** What failed, when the server answered with a reason: "Settings didn’t load." */
	what: string;
	/** The server's reason; null when it never answered, which reads as the server being down. */
	reason: string | null;
	retry: Retry;
}

/** A whole section with nothing to show: the server is down, or it refused the one load the section needs. */
export function SectionNotice({ what, reason, retry }: SectionNoticeProps) {
	return (
		<StatusNotice
			variant="page"
			heading="h2"
			title={reason ? what : OFFLINE_TEXT}
			detail={reason ?? OFFLINE_DETAIL}
			actions={<TryAgain retry={retry} />}
		/>
	);
}
