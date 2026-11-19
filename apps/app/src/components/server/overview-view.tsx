'use client';

import type { ServerOverview, StorageStatus, TlsStatus } from '@recoder/shared';
import { Button } from '@recoder/ui';

import { serverApi } from '@/lib/api/server';
import { useChecks } from '@/lib/server/use-checks';
import { useServerRead } from '@/lib/server/use-server-read';
import { dayDate, fullTime } from '@/lib/shell/age';
import { formatBytes, plural } from '@/lib/shell/format';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { CheckList } from './check-list';

/** How the address is served: Recoder's own certificate and when it runs out, a proxy's, or none. */
function tlsLine(tls: TlsStatus): string {
	switch (tls.state) {
		case 'issued':
			return tls.expiresAt ? `Certificate until ${dayDate(tls.expiresAt)}` : 'Certificate issued';
		case 'external':
			return 'HTTPS from your proxy';
		case 'pending':
			return 'Requesting a certificate';
		case 'failed':
			return tls.error ?? 'The certificate was not issued';
		case 'off':
			return 'No HTTPS';
	}
}

/** Where the data lives, and how much of it there is. */
function storageLine(storage: StorageStatus): string {
	const size = storage.sizeBytes === null ? null : formatBytes(storage.sizeBytes);

	if (storage.kind === 'builtin') return size ? `Built-in database, ${size}` : 'Built-in database';

	return [`PostgreSQL`, storage.location, size].filter(Boolean).join(', ');
}

function Facts({ overview }: { overview: ServerOverview }) {
	const { disk, reviews } = overview;

	return (
		<SettingsGroup title="This server">
			<SettingsRow name="Version" detail={`Running since ${fullTime(overview.startedAt)}`}>
				<span className="server-fact">{overview.version}</span>
			</SettingsRow>
			<SettingsRow name="Address" detail={tlsLine(overview.tls)}>
				<span className="server-fact" data-face="code">
					{overview.publicUrl ?? 'Not set'}
				</span>
			</SettingsRow>
			<SettingsRow name="Storage" detail={storageLine(overview.storage)} />
			<SettingsRow
				name="Disk"
				detail={disk ? `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}` : 'Not measured'}
			/>
			<SettingsRow
				name="Reviews"
				detail={`${plural(reviews.running, 'running', 'running')}, ${plural(reviews.queued, 'queued', 'queued')}`}
			/>
		</SettingsGroup>
	);
}

/** The server's checks, as they last ran; Run checks runs them again, the review model's one call included. */
function Checks() {
	const checks = useChecks(false);

	return (
		<SettingsGroup
			title="Checks"
			action={
				<Button variant="ghost" onClick={checks.run} status={checks.running ? 'pending' : 'idle'}>
					Run checks
				</Button>
			}
		>
			<div className="server-checks-card">
				<CheckList view={checks} />
			</div>
		</SettingsGroup>
	);
}

/** Settings → Server → Overview: what this server runs and where, then its checks. */
export function OverviewView() {
	const overview = useServerRead(serverApi.overview, 'The server did not say how it runs.');

	return (
		<div className="settings">
			{overview.data ? <Facts overview={overview.data} /> : null}
			{!overview.data && overview.error ? (
				<SectionNotice what="The server" error={overview.error} retry={{ status: 'idle', run: overview.reload }} />
			) : null}
			{!overview.data && !overview.error ? <SettingsSkeleton groups={[5]} /> : null}
			<Checks />
		</div>
	);
}
