'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import { Button } from '@recoder/ui';

import { useGuidelines } from '@/lib/guidelines/guidelines-store';
import { useGuidelinesSection, type GuidelinesSection } from '@/lib/guidelines/use-guidelines-section';
import { openSettings } from '@/lib/settings/open-settings';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsPage } from '@/components/settings/settings-page';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { GuidelinesConfirm } from './guidelines-confirm';
import { RepoRow } from './repo-row';

/** The rows of the group, for the skeleton that stands in while they load. */
const SKELETON_GROUPS = [2] as const;

/** Tracked repositories, each with its own file; or the way to connect one. */
function Repositories({ overview }: { overview: GuidelinesOverview }) {
	if (overview.repos.length === 0) {
		return (
			<SettingsGroup title="Repositories">
				<SettingsRow name="No repositories yet" detail="Connect a repository to give it its own guidelines.">
					<Button variant="outline" onClick={() => openSettings('connections')}>
						Open Connections
					</Button>
				</SettingsRow>
			</SettingsGroup>
		);
	}

	return (
		<SettingsGroup title="Repositories" note="A change opens a pull request. Reviews follow it once it merges.">
			{overview.repos.map((repo) => (
				<RepoRow key={repo.id} repo={repo} overview={overview} />
			))}
		</SettingsGroup>
	);
}

/** The repositories once the overview loads: a skeleton before that, and a notice when it does not. */
function Layers({ section }: { section: GuidelinesSection }) {
	const { overview, status } = section;

	if (overview) {
		return (
			<div className="settings">
				<Repositories overview={overview} />
			</div>
		);
	}

	if (status === 'offline' || status === 'failed') {
		return <SectionNotice what="Guidelines" error={status === 'failed' ? section.error : null} retry={section.retry} />;
	}

	return <SettingsSkeleton groups={SKELETON_GROUPS} />;
}

/**
 * Guidelines: each tracked repository's own `RECODER.md`, which a change to
 * proposes as a pull request. The layer that applies to every review is the
 * admin's, under Settings → Recoder.
 */
export function GuidelinesScreen() {
	const section = useGuidelinesSection(useGuidelines.getState().load);

	return (
		<SettingsPage name="Guidelines">
			<Layers section={section} />
			<GuidelinesConfirm />
		</SettingsPage>
	);
}
