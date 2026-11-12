'use client';

import type { PrCheck } from '@recoder/shared';
import {
	Button,
	HoverList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	RowButton,
	Skeleton,
	StatusGlyph,
	type GlyphKind
} from '@recoder/ui';
import { ArrowUpRight, ChevronUp, CircleCheck, CircleDashed, CircleX } from 'lucide-react';

import type { PullChecksView } from '@/lib/pull/types';
import { plural } from '@/lib/shell/format';

const GLYPHS: Record<PrCheck['state'], GlyphKind> = {
	failed: 'failed',
	pending: 'idle',
	running: 'spinner',
	passed: 'ok',
	skipped: 'dismissed'
};

const STATE_LABELS: Record<PrCheck['state'], string> = {
	failed: 'Failed',
	pending: 'Waiting',
	running: 'Running',
	passed: 'Passed',
	skipped: 'Skipped'
};

interface Summary {
	tone: 'ok' | 'bad' | 'wait';
	text: string;
}

/** One sentence for all the checks: the failures first, then what still runs, then the count that passed. */
function summarize({ outcome, tally }: PullChecksView): Summary {
	const total = tally.passed + tally.failed + tally.pending;

	if (outcome === 'failed') return { tone: 'bad', text: `${tally.failed} of ${plural(total, 'check')} failed` };
	if (outcome === 'pending') return { tone: 'wait', text: `${plural(tally.pending, 'check')} running` };

	return { tone: 'ok', text: `${plural(tally.passed, 'check')} passed` };
}

const SUMMARY_ICONS = { ok: CircleCheck, bad: CircleX, wait: CircleDashed };

/** One check: its state, its name, and its page on the forge when it has one. */
function CheckRow({ check }: { check: PrCheck }) {
	const body = (
		<>
			<StatusGlyph kind={GLYPHS[check.state]} label={STATE_LABELS[check.state]} />
			<span className="check-row-name">{check.name}</span>
		</>
	);

	if (!check.url) {
		return (
			<div data-check className="check-row flex">
				{body}
			</div>
		);
	}

	return (
		<RowButton asChild data-check className="check-row">
			<a href={check.url} target="_blank" rel="noreferrer">
				{body}
				<ArrowUpRight aria-hidden />
			</a>
		</RowButton>
	);
}

/**
 * The head commit's checks in the merge bar: one sentence, and the list
 * behind it. Nothing shows for a commit with no checks.
 */
export function ChecksPopover({ view }: { view: PullChecksView }) {
	if (view.phase === 'loading') return <Skeleton className="mx-2.5 h-3 w-28" />;
	if (view.phase === 'none') return null;

	if (view.phase === 'failed') {
		return (
			<span className="merge-bar-fact" data-tone="wait" title={view.error ?? undefined}>
				<CircleDashed aria-hidden />
				The checks did not load
			</span>
		);
	}

	const summary = summarize(view);
	const Icon = SUMMARY_ICONS[summary.tone];

	return (
		<Popover>
			<PopoverTrigger>
				<Button variant="quiet" className="merge-bar-fact" data-tone={summary.tone}>
					<Icon aria-hidden />
					{summary.text}
					<ChevronUp aria-hidden className="size-3 text-fg-faint" />
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="p-0">
				<div className="checks">
					<h2 className="section-label checks-head">Checks</h2>
					<HoverList className="checks-list" itemSelector="[data-check]">
						{view.checks.map((check) => (
							<CheckRow key={check.id ?? check.name} check={check} />
						))}
					</HoverList>
				</div>
			</PopoverContent>
		</Popover>
	);
}
