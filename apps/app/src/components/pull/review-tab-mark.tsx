'use client';

import { Spinner, Tooltip } from '@recoder/ui';
import { WarningCircleIcon, ClockIcon, ClockCounterClockwiseIcon, PauseIcon, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import type { RunView } from '@/lib/run/types';

import { RunClock } from '@/components/common/run-clock';

/** A review that is not done but not running either, as the glyph the Review tab wears. */
type WaitingState = 'queued' | 'paused' | 'failed' | 'outdated';

interface Glyph {
	/** The word for it, as a tooltip and for a screen reader. */
	label: string;
	icon: Icon;
	tone?: 'danger' | 'medium';
}

const GLYPHS: Record<WaitingState, Glyph> = {
	queued: { label: 'Queued', icon: ClockIcon },
	paused: { label: 'Paused', icon: PauseIcon },
	failed: { label: 'Failed', icon: WarningCircleIcon, tone: 'danger' },
	outdated: { label: 'Out of date', icon: ClockCounterClockwiseIcon, tone: 'medium' }
};

/** Where the review stands for the tab: running, one of the glyph states, or `done` (done, or none yet) when the tab shows its open bugs. */
function stateOf(run: RunView): WaitingState | 'running' | 'done' {
	if (run.phase === 'running' || run.phase === 'queued' || run.phase === 'paused' || run.phase === 'failed') {
		return run.phase;
	}

	return run.phase === 'passed' && run.outdated ? 'outdated' : 'done';
}

/**
 * What the Review tab wears after its name: a spinner and the time a running
 * review has run, or a glyph for a queued, paused, failed or out-of-date one.
 * Null once the review is done, or before there is one, so the tab shows its
 * open bugs instead.
 */
export function reviewTabMark(run: RunView): ReactNode {
	const state = stateOf(run);

	if (state === 'done') return null;

	if (state === 'running') {
		return (
			<span className="page-tab-mark" role="img" aria-label="Reviewing">
				<Spinner size={12} />
				{run.startedAt ? <RunClock since={run.startedAt} /> : null}
			</span>
		);
	}

	const { label, icon: Icon, tone } = GLYPHS[state];

	return (
		<Tooltip content={label}>
			<span className="page-tab-mark" data-tone={tone} role="img" aria-label={label}>
				<Icon aria-hidden />
			</span>
		</Tooltip>
	);
}
