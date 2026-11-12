'use client';

import { CopyButton } from '@recoder/ui';

import { useWebhookActivity } from '@/lib/settings/use-activity';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

/** Automations → Webhooks: where a forge can report events, so a review starts without waiting for a check. */
export function WebhooksGroup() {
	const { rows } = useWebhookActivity();

	if (!rows) return null;

	return (
		<SettingsGroup
			title="Webhooks"
			note="A webhook reports a mention or a new pull request at once, so the review starts before the next check. Send pull request and comment events."
		>
			{rows.map((row) => (
				<SettingsRow
					key={row.forge}
					name={row.forge}
					detail={<span className="mono automations-address">{row.url}</span>}
				>
					<CopyButton value={row.url} label={`Copy the ${row.forge} webhook address`} iconOnly />
				</SettingsRow>
			))}
		</SettingsGroup>
	);
}
