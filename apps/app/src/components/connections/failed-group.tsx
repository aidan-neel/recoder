import { Button } from '@recoder/ui';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useRetryWhenBack } from '@/lib/api/use-retry-when-back';
import type { ActionFace } from '@/lib/connections/use-remote-list';

interface FailedGroupProps {
	/** The group's title, which also names what did not load. */
	title: string;
	/** The server's reason; null when it never answered. */
	reason: string | null;
	retry: ActionFace;
}

/** A group whose load failed: what did not load, why, and a way to load it again. */
export function FailedGroup({ title, reason, retry }: FailedGroupProps) {
	useRetryWhenBack(retry.run);

	return (
		<SettingsGroup title={title}>
			<SettingsRow name={`${title} did not load`} error={reason ?? OFFLINE_TEXT}>
				<Button variant="outline" status={retry.status} onClick={retry.run}>
					Try again
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
