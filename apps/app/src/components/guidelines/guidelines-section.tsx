'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import { ConfirmDialog } from '@recoder/ui';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { SectionNotice } from '@/components/settings/group-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsSectionSkeleton } from '@/components/settings/settings-skeleton';
import { useGuidelinesEditor } from '@/lib/guidelines/editor-store';
import { retryGuidelines, useGuidelines } from '@/lib/guidelines/guidelines-store';

import { GlobalRow } from './global-row';
import { OpenConnections } from './open-connections';
import { RepoRow } from './repo-row';

/** Tracked repositories, each with its own file; or the way to track one. */
function ReposGroup({ overview, editing }: { overview: GuidelinesOverview; editing: boolean }) {
	if (overview.repos.length === 0) {
		return (
			<SettingsGroup title="Repositories" group="repoGuidelines">
				<SettingsRow
					name="No repositories tracked yet"
					description="Track one in Connections to give it its own guidelines"
				>
					<OpenConnections />
				</SettingsRow>
			</SettingsGroup>
		);
	}

	return (
		<SettingsGroup title="Repositories" group="repoGuidelines" transient={editing}>
			{overview.repos.map((repo) => (
				<RepoRow key={repo.id} repo={repo} overview={overview} />
			))}
		</SettingsGroup>
	);
}

/**
 * Remembers what had focus before the dialog opened (layout effects run
 * before the dialog moves focus), so Keep editing can put the caret back
 * where it was. The dialog has no trigger to return to on its own.
 */
function useFocusBefore(asking: boolean) {
	const before = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (asking) before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}, [asking]);

	return () => {
		const target = before.current;

		setTimeout(() => target?.focus({ preventScroll: true }));
	};
}

/** "Discard your changes?", asked before an action would drop an editor's unsaved text. */
function DiscardConfirm() {
	const asking = useGuidelinesEditor((state) => state.confirm !== null);
	const restoreFocus = useFocusBefore(asking);

	return (
		<ConfirmDialog
			open={asking}
			onOpenChange={(open) => {
				if (open || !useGuidelinesEditor.getState().confirm) return;

				useGuidelinesEditor.getState().settleConfirm(false);
				restoreFocus();
			}}
			title="Discard your changes?"
			description="Your edits to these guidelines will be lost."
			confirmLabel="Discard"
			cancelLabel="Keep editing"
			destructive
			onConfirm={() => useGuidelinesEditor.getState().settleConfirm(true)}
		/>
	);
}

/**
 * Settings → Guidelines: what reviewers follow. The global layer applies to
 * every review; each tracked repository adds its own `.recoder/REVIEW.md`,
 * read from the pull request's base branch. Each layer edits in place; while
 * an editor is open the groups' heights are not kept for the next load's
 * skeleton, which opens with every editor closed.
 */
export function GuidelinesSection() {
	const status = useGuidelines((state) => state.status);
	const overview = useGuidelines((state) => state.overview);
	const error = useGuidelines((state) => state.error);
	const editing = useGuidelinesEditor((state) => state.open !== null);

	useEffect(() => {
		void useGuidelines.getState().load();
	}, []);

	if (!overview) {
		if (status === 'loading') return <SettingsSectionSkeleton section="guidelines" />;

		return (
			<SectionNotice
				what="Guidelines didn’t load."
				reason={status === 'failed' ? error : null}
				retry={retryGuidelines}
			/>
		);
	}

	return (
		<div className="settings-stack">
			<SettingsGroup title="Global" group="globalGuidelines" transient={editing}>
				<GlobalRow overview={overview} />
			</SettingsGroup>
			<ReposGroup overview={overview} editing={editing} />
			<DiscardConfirm />
		</div>
	);
}
