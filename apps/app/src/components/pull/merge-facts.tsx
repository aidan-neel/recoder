'use client';

import type { PullMergeability, PullPage } from '@recoder/shared';
import { CheckCircleIcon, CircleDashedIcon, XCircleIcon } from '@phosphor-icons/react';

import type { MergeView, PullChecksView } from '@/lib/pull/types';

import { ChecksToggle } from './checks';
import { MergeButton } from './merge-button';
import { PullMenu } from './pull-menu';

interface Fact {
	tone: 'ok' | 'bad' | 'wait';
	text: string;
}

const FACT_ICONS = { ok: CheckCircleIcon, bad: XCircleIcon, wait: CircleDashedIcon };

/** What the forge says about merging into `base`; nothing while it has not worked it out. */
function mergeFact(mergeability: PullMergeability, base: string): Fact | null {
	if (mergeability === 'clean') return { tone: 'ok', text: `No conflicts with ${base}` };
	if (mergeability === 'conflicts') return { tone: 'bad', text: `Conflicts with ${base}` };
	if (mergeability === 'blocked') return { tone: 'wait', text: 'Blocked by a branch rule' };

	return null;
}

interface MergeFactsProps {
	page: PullPage;
	checks: PullChecksView;
}

/**
 * Can this merge? The end of the header's facts: the checks (which open into
 * their list under the facts) and the conflicts, as quiet text after a
 * hairline. Nothing shows for a pull request without checks.
 */
export function MergeFacts({ page, checks }: MergeFactsProps) {
	const fact = page.status.state === 'open' ? mergeFact(page.status.mergeability, page.pull.base) : null;
	const FactIcon = fact ? FACT_ICONS[fact.tone] : null;

	if (checks.phase === 'none' && !fact) return null;

	return (
		<div className="merge-facts">
			<ChecksToggle view={checks} />
			{fact && FactIcon ? (
				<span className="merge-fact" data-tone={fact.tone}>
					<FactIcon aria-hidden />
					{fact.text}
				</span>
			) : null}
		</div>
	);
}

interface MergeActionsProps {
	page: PullPage;
	merge: MergeView;
	/** True when the newest review left nothing open and none runs; see `MergeButton`. */
	settled: boolean;
}

/** The end of the title's row: why a merge failed, the pull request's menu, and the merge button. */
export function MergeActions({ page, merge, settled }: MergeActionsProps) {
	return (
		<>
			{merge.phase === 'failed' && merge.error ? (
				<span className="merge-error" role="alert" title={merge.error}>
					{merge.error}
				</span>
			) : null}
			<PullMenu page={page} />
			<MergeButton view={merge} pull={`#${page.pull.number}`} base={page.pull.base} settled={settled} />
		</>
	);
}
