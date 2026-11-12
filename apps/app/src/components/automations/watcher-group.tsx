'use client';

import type { Repo } from '@recoder/shared';
import { Button, Select } from '@recoder/ui';
import { CircleAlert } from 'lucide-react';

import { useWatcher, type WatcherError, type WatcherStatus } from '@/lib/settings/use-watcher';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { SwitchRow } from './switch-row';

const WATCH = 'Watch repositories';

/** How the last round went, with a button that runs one now. */
function StatusRow({ status }: { status: WatcherStatus }) {
	return (
		<SettingsRow name={status.text} detail={status.description}>
			<Button variant="outline" status={status.status} disabled={!status.enabled} onClick={status.run}>
				Check now
			</Button>
		</SettingsRow>
	);
}

/** The repositories the last round could not read, and why. The rest of the page still works. */
function WatcherErrors({ errors }: { errors: WatcherError[] }) {
	if (errors.length === 0) return null;

	return (
		<ul className="automations-errors" aria-label="Repositories the last check could not read">
			{errors.map((error) => (
				<li key={error.repoId} className="strip">
					<CircleAlert aria-hidden />
					<span className="strip-text">
						<strong>{error.name}</strong>
						<span className="meta-sep">{error.message}</span>
					</span>
				</li>
			))}
		</ul>
	);
}

/** Automations → Watcher: on or off, how often it checks, and how the last round went. */
export function WatcherGroup({ repos }: { repos: Repo[] }) {
	const watcher = useWatcher(repos);

	return (
		<div className="automations-block">
			<SettingsGroup title="Watcher">
				<SwitchRow
					name={WATCH}
					label={WATCH}
					detail={
						watcher.enabled.on
							? 'Recoder checks for mentions and new pull requests on its own'
							: 'Reviews start only when you ask for one'
					}
					toggle={watcher.enabled}
				/>
				<SettingsRow
					name="Check every"
					detail="How often Recoder reads each watched repository"
					state={watcher.interval.state}
				>
					<Select
						className="automations-interval"
						contentClassName="automations-menu"
						aria-label="Check every"
						value={String(watcher.interval.value)}
						onValueChange={watcher.interval.change}
						options={watcher.interval.options}
					/>
				</SettingsRow>
				{watcher.status ? <StatusRow status={watcher.status} /> : null}
			</SettingsGroup>
			<WatcherErrors errors={watcher.errors} />
		</div>
	);
}
