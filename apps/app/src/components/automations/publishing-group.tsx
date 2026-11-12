'use client';

import type { CheckThreshold } from '@recoder/shared';
import { Button, Input, Select } from '@recoder/ui';
import { X } from 'lucide-react';

import { useAutoReviewSwitch } from '@/lib/settings/use-auto-review-switch';
import { useCheckThreshold } from '@/lib/settings/use-check-threshold';
import { useIgnoredPaths, type IgnoredPathsView } from '@/lib/settings/use-ignored-paths';
import { useInlineCommentLimit } from '@/lib/settings/use-inline-comment-limit';

import { NumberRow } from '@/components/settings/number-row';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { SwitchRow } from './switch-row';

const POST = 'Post results';

/** What the commit check does at each threshold. */
const CHECK_DETAIL: Record<CheckThreshold, string> = {
	error: 'The check fails when a verified finding is high severity',
	warning: 'The check fails when a verified finding is medium or high',
	info: 'The check fails when any finding is verified',
	off: 'Recoder sets no check on the commit'
};

/** Whether a finished automatic review writes to the pull request at all. */
function PostResultsRow() {
	const toggle = useAutoReviewSwitch('postResults');

	return (
		<SwitchRow
			name={POST}
			label={POST}
			detail={
				toggle.on
					? 'Verified findings go on the pull request as one review; a GitLab token needs the api scope'
					: 'Results stay in Recoder until you post them'
			}
			toggle={toggle}
		/>
	);
}

/** The severity from which Recoder's check on the head commit fails. */
function CheckThresholdRow() {
	const view = useCheckThreshold();

	function choose(value: string): void {
		const picked = view.options.find((option) => option.value === value);

		if (picked) view.choose(picked.value);
	}

	return (
		<SettingsRow name="Commit check" detail={CHECK_DETAIL[view.value]} error={view.error} state={view.state}>
			<Select
				className="automations-threshold"
				contentClassName="automations-menu"
				aria-label="Commit check"
				value={view.value}
				onValueChange={choose}
				options={view.options}
			/>
		</SettingsRow>
	);
}

/** How many findings one review may put on their lines. */
function InlineCommentsRow() {
	const view = useInlineCommentLimit();

	return (
		<NumberRow
			name="Comments on lines"
			detail="The most findings one review posts on their lines; the rest go in its summary"
			view={view}
		/>
	);
}

/** The saved globs under their row, each with the button that removes it. */
function IgnoredGlobs({ view }: { view: IgnoredPathsView }) {
	if (view.paths.length === 0) return null;

	return (
		<ul className="automations-globs" aria-label="Ignored paths">
			{view.paths.map((path) => (
				<li key={path} className="automations-glob">
					<span className="mono">{path}</span>
					<Button variant="ghost" size="icon" aria-label={`Stop ignoring ${path}`} onClick={() => view.remove(path)}>
						<X />
					</Button>
				</li>
			))}
		</ul>
	);
}

/** Paths whose findings stay off the pull request: a glob is added with Enter or Add, and removed from its chip. */
function IgnoredPathsRows() {
	const view = useIgnoredPaths();

	return (
		<>
			<SettingsRow
				name="Ignored paths"
				detail="Findings in these paths are never posted and never fail the check"
				error={view.error}
				state={view.state}
			>
				<Input
					className="automations-code-field"
					aria-label="Path to ignore"
					placeholder="docs/**"
					autoComplete="off"
					spellCheck={false}
					disabled={view.full}
					invalid={view.error !== null}
					value={view.draft}
					onChange={(event) => view.edit(event.target.value)}
					onKeyDown={view.onKeyDown}
				/>
				<Button variant="outline" disabled={view.full || view.draft.trim() === ''} onClick={view.add}>
					Add
				</Button>
			</SettingsRow>
			<IgnoredGlobs view={view} />
		</>
	);
}

/** Automations → Publishing: what a review writes on the pull request, and what it leaves out. */
export function PublishingGroup() {
	return (
		<SettingsGroup
			title="Publishing"
			note="These also apply when you post a review's findings yourself from its Bugs tab."
		>
			<PostResultsRow />
			<CheckThresholdRow />
			<InlineCommentsRow />
			<IgnoredPathsRows />
		</SettingsGroup>
	);
}
