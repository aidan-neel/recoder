'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import { Button, ConfirmDialog } from '@recoder/ui';
import Link from 'next/link';

import { useGlobalRow } from '@/lib/guidelines/use-global-row';
import { useGuidelinesSection, type GuidelinesSection } from '@/lib/guidelines/use-guidelines-section';
import { settingsHref } from '@/lib/shell/routes';

import { ColumnPage } from '@/components/common/column-page';
import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

import { LayerRow } from './layer-row';
import { RepoRow } from './repo-row';

/** The rows of the two groups, for the skeleton that stands in while they load. */
const SKELETON_GROUPS = [1, 2] as const;

/**
 * The global layer: saved on this machine and applied to every repository.
 * Never saved, it holds Recoder's defaults, which the editor opens on so they
 * can be adjusted and not retyped.
 */
function GlobalRow({ overview }: { overview: GuidelinesOverview }) {
	return <LayerRow name="Global guidelines" view={useGlobalRow(overview)} />;
}

/** Tracked repositories, each with its own file; or the way to connect one. */
function Repositories({ overview }: { overview: GuidelinesOverview }) {
	if (overview.repos.length === 0) {
		return (
			<SettingsGroup title="Repositories">
				<SettingsRow name="No repositories yet" detail="Connect a repository to give it its own guidelines.">
					<Button variant="outline" asChild>
						<Link href={settingsHref('connections')}>Open Connections</Link>
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

/** The two layers once the overview loads: a skeleton before that, and a notice when it does not. */
function Layers({ section }: { section: GuidelinesSection }) {
	const { overview, status } = section;

	if (overview) {
		return (
			<div className="settings">
				<SettingsGroup title="Every review">
					<GlobalRow overview={overview} />
				</SettingsGroup>
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
 * Guidelines: what reviewers follow. One layer applies to every review; each
 * tracked repository adds its own file. A layer edits in place, one at a
 * time, and leaving unsaved text asks first.
 */
export function GuidelinesScreen() {
	const section = useGuidelinesSection();

	return (
		<ColumnPage title="Guidelines">
			<Layers section={section} />
			<ConfirmDialog
				open={section.asking}
				onOpenChange={(open) => {
					if (!open) section.keepEditing();
				}}
				title="Discard your changes?"
				description="Your edits to these guidelines will be lost."
				confirmLabel="Discard"
				cancelLabel="Keep editing"
				destructive
				onConfirm={section.discard}
			/>
		</ColumnPage>
	);
}
