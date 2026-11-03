'use client';

import { shortAge, type Repo } from '@recoder/shared';
import { Button, CopyButton } from '@recoder/ui';
import Link from 'next/link';

import { API_BASE } from '@/lib/api/http';
import { useAutoReview } from '@/lib/settings/auto-review-store';
import { reasonText } from '@/lib/settings/auto-review-text';
import { pullRef } from '@/lib/shell/format';
import { reviewHref } from '@/lib/shell/routes';

import { SettingsGroup, SettingsRow } from '../settings-group';

/** Settings → Auto-review → Recent: the latest reviews the watcher started, each a link to its review. */
export function RecentGroup({ repos }: { repos: Repo[] }) {
	const recent = useAutoReview((state) => state.payload?.status.recent ?? []);

	return (
		<SettingsGroup title="Recent">
			{recent.length ? (
				recent.map((event) => {
					const repo = repos.find((item) => item.id === event.repoId)?.name ?? 'repository';
					const age = shortAge(event.at);

					return (
						<SettingsRow
							key={event.reviewId}
							name={pullRef(repo, event.prNumber)}
							description={age ? `${reasonText(event)} · ${age} ago` : reasonText(event)}
						>
							<Button asChild variant="outline">
								<Link href={reviewHref(event.reviewId)}>Open</Link>
							</Button>
						</SettingsRow>
					);
				})
			) : (
				<SettingsRow name="Nothing yet" description="Reviews the watcher starts show here" />
			)}
		</SettingsGroup>
	);
}

/** One webhook address, copyable. */
function WebhookRow({ forge, path }: { forge: string; path: string }) {
	const url = `${API_BASE}${path}`;

	return (
		<SettingsRow name={`${forge} webhook`} description={<span className="settings-path">{url}</span>}>
			<CopyButton value={url} label={`Copy the ${forge} webhook address`} iconOnly />
		</SettingsRow>
	);
}

/** Settings → Auto-review → Webhooks: where a forge can report events instead of waiting for the next check. */
export function WebhookGroup() {
	const paths = useAutoReview((state) => state.payload?.webhookPaths);

	if (!paths) return null;

	return (
		<SettingsGroup title="Webhooks">
			<SettingsRow
				name="Instead of polling"
				description="Point a GitLab or GitHub webhook here, with merge request and comment events, and reviews start at once"
			/>
			<WebhookRow forge="GitLab" path={paths.gitlab} />
			<WebhookRow forge="GitHub" path={paths.github} />
		</SettingsGroup>
	);
}
