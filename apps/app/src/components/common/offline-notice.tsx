import { Button, Icon, StatusNotice } from '@recoder/ui';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useRetryWhenBack } from '@/lib/api/use-retry-when-back';

/** The review server does not answer: a danger banner that says so, asks again on its own once it is back, and offers to ask now. */
export function OfflineNotice({ onRetry }: { onRetry: () => void }) {
	useRetryWhenBack(onRetry);

	return (
		<StatusNotice
			tone="danger"
			title={OFFLINE_TEXT}
			detail="Recoder tries again by itself once it’s back."
			actions={
				<Button onClick={onRetry}>
					<Icon name="replay" />
					Try again
				</Button>
			}
		/>
	);
}
