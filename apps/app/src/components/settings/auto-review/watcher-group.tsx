'use client';

import { AUTO_REVIEW_INTERVALS, type AutoReviewInterval, type Repo } from '@recoder/shared';
import { Button, Select, Switch } from '@recoder/ui';
import { CircleAlert } from 'lucide-react';

import { failureText } from '@/lib/api/http';
import { useAutoReview } from '@/lib/settings/auto-review-store';
import { checkText, intervalLabel } from '@/lib/settings/auto-review-text';
import { useInstantChange } from '@/lib/settings/use-save-state';
import { plural } from '@/lib/shell/format';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';
import { useNow } from '@/lib/shell/use-now';

import { SaveStatus } from '../save-status';
import { SettingsGroup, SettingsRow } from '../settings-group';
import { AUTO_REVIEW_FAILED, useAutoReviewSwitch } from './toggle-row';

const INTERVAL_OPTIONS = AUTO_REVIEW_INTERVALS.map((seconds) => ({
	value: String(seconds),
	label: intervalLabel(seconds)
}));

/** Runs one round of checks now; a failure says why in a toast as well as on the button. */
function checkNow(): Promise<void> {
	return useAutoReview
		.getState()
		.check()
		.catch((error: unknown) => {
			errorToast('Couldn’t check the repositories', failureText(error));

			throw error;
		});
}

/** The last round's state, with Check now. */
function StatusRow({ enabled }: { enabled: boolean }) {
	const status = useAutoReview((state) => state.payload?.status);
	const now = useNow(5000);
	const check = useAction({ showSuccess: true });

	if (!status) return null;

	const watching = plural(status.watching, 'repository', 'repositories');

	return (
		<SettingsRow
			name={checkText(status.lastCheckAt, enabled ? status.nextCheckAt : null, now)}
			description={enabled ? `Watching ${watching}` : 'Turn on watching to check'}
		>
			<Button variant="outline" status={check.status} disabled={!enabled} onClick={() => check.run(checkNow)}>
				Check now
			</Button>
		</SettingsRow>
	);
}

/** One repository the last round could not check, and why. */
function ErrorRow({ name, message }: { name: string; message: string }) {
	return (
		<SettingsRow
			name={name}
			description={message}
			leading={<CircleAlert aria-label="Failed" className="size-4 shrink-0 text-danger" />}
		/>
	);
}

/** Settings → Auto-review → Watcher: on or off, how often, and how the last round went. */
export function WatcherGroup({ repos }: { repos: Repo[] }) {
	const enabled = useAutoReviewSwitch('enabled');
	const savedInterval = useAutoReview((state) => state.payload?.settings.intervalSeconds ?? 120);
	const errors = useAutoReview((state) => state.payload?.status.errors ?? []);

	const interval = useInstantChange(
		(intervalSeconds: AutoReviewInterval) => useAutoReview.getState().save({ intervalSeconds }),
		AUTO_REVIEW_FAILED
	);

	const every = interval.draft ? interval.draft.value : savedInterval;
	const nameOf = (id: string) => repos.find((repo) => repo.id === id)?.name ?? 'A repository';

	return (
		<SettingsGroup title="Watcher">
			<SettingsRow
				name="Watch repositories"
				description={
					enabled.on
						? 'Recoder checks for mentions and new pull requests on its own'
						: 'Reviews start only when you ask for one'
				}
			>
				<SaveStatus state={enabled.state} />
				<Switch checked={enabled.on} onCheckedChange={enabled.change} aria-label="Watch repositories" />
			</SettingsRow>
			<SettingsRow name="Check every" description="Each tracked repository, unless a webhook already reports it">
				<SaveStatus state={interval.state} />
				<Select
					aria-label="Check every"
					value={String(every)}
					onValueChange={(value) => interval.change(Number(value) as AutoReviewInterval)}
					options={INTERVAL_OPTIONS}
				/>
			</SettingsRow>
			<StatusRow enabled={enabled.on} />
			{errors.map((error) => (
				<ErrorRow key={error.repoId} name={nameOf(error.repoId)} message={error.message} />
			))}
		</SettingsGroup>
	);
}
