'use client';

import type { GuidelinesOverview } from '@recoder/shared';
import { Button, ConfirmDialog } from '@recoder/ui';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { useGuidelinesEditor } from '@/lib/guidelines/editor-store';
import { useGuidelines } from '@/lib/guidelines/guidelines-store';
import { useAction } from '@/lib/shell/use-action';

import { GlobalRow } from './global-row';
import { RepoRow } from './repo-row';

/** The overview never loaded: the server is down, or it answered with an error. */
function LoadNotice() {
	const status = useGuidelines((state) => state.status);
	const error = useGuidelines((state) => state.error);
	const retry = useAction();
	const offline = status === 'offline';

	return (
		<PageNotice
			heading="h2"
			lead={offline ? OFFLINE_TEXT : 'Guidelines didn’t load.'}
			rest={offline ? 'Start it, then try again.' : error}
		>
			<Button status={retry.status} onClick={() => retry.run(() => useGuidelines.getState().load())}>
				Try again
			</Button>
		</PageNotice>
	);
}

/** Tracked repositories, each with its own file; or the way to track one. */
function ReposGroup({ overview }: { overview: GuidelinesOverview }) {
	if (overview.repos.length === 0) {
		return (
			<SettingsGroup title="Repositories">
				<div className="settings-row">
					<p className="guidelines-empty">Track a repository in Connections to give it its own guidelines.</p>
					<Button variant="outline" asChild>
						<Link href="/settings/connections">Open Connections</Link>
					</Button>
				</div>
			</SettingsGroup>
		);
	}

	return (
		<SettingsGroup title="Repositories">
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
 * read from the pull request's base branch. Each layer edits in place.
 */
export function GuidelinesSection() {
	const status = useGuidelines((state) => state.status);
	const overview = useGuidelines((state) => state.overview);

	useEffect(() => {
		void useGuidelines.getState().load();
	}, []);

	if (!overview) {
		if (status === 'offline' || status === 'failed') return <LoadNotice />;

		return <SettingsSkeleton groups={[1, 2]} />;
	}

	return (
		<div className="settings-stack">
			<SettingsGroup title="Global">
				<GlobalRow overview={overview} />
			</SettingsGroup>
			<ReposGroup overview={overview} />
			<DiscardConfirm />
		</div>
	);
}
