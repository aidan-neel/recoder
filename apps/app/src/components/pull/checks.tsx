'use client';

import type { PrCheck } from '@recoder/shared';
import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	HoverList,
	RowButton,
	ScrollArea,
	Skeleton,
	StatusGlyph,
	type GlyphKind
} from '@recoder/ui';
import { ArrowUpRight, ChevronDown, CircleCheck, CircleDashed, CircleX } from 'lucide-react';

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

/**
 * The head commit's checks as one fact in the merge strip. When they loaded,
 * it is the button that opens the list under the strip.
 */
export function ChecksToggle({ view }: { view: PullChecksView }) {
	if (view.phase === 'loading') return <Skeleton className="merge-fact-skeleton" />;

	if (view.phase === 'none') {
		return (
			<span className="merge-fact" data-tone="none">
				<CircleDashed aria-hidden />
				No checks
			</span>
		);
	}

	if (view.phase === 'failed') {
		return (
			<span className="merge-fact" data-tone="wait" title={view.error ?? undefined}>
				<CircleDashed aria-hidden />
				The checks did not load
			</span>
		);
	}

	const summary = summarize(view);
	const Icon = SUMMARY_ICONS[summary.tone];

	return (
		<CollapsibleTrigger asChild>
			<Button variant="quiet" className="merge-fact checks-toggle" data-tone={summary.tone}>
				<Icon aria-hidden />
				{summary.text}
				<ChevronDown aria-hidden className="checks-chevron" />
			</Button>
		</CollapsibleTrigger>
	);
}

/** One check: its state, its name and, on hover or focus, the way to its page on the forge. */
function CheckRow({ check }: { check: PrCheck }) {
	const body = (
		<>
			<StatusGlyph kind={GLYPHS[check.state]} label={STATE_LABELS[check.state]} />
			<span className="check-row-name">{check.name}</span>
			{check.state === 'failed' ? <span className="check-row-state">Failed</span> : null}
		</>
	);

	if (!check.url) {
		return (
			<div data-check className="check-row flex" title={check.name}>
				{body}
			</div>
		);
	}

	return (
		<RowButton asChild data-check className="check-row">
			<a href={check.url} target="_blank" rel="noreferrer" title={check.name}>
				{body}
				<ArrowUpRight aria-hidden className="check-row-link" />
			</a>
		</RowButton>
	);
}

/** Rows laid into as many columns as the strip's width holds. */
function CheckGrid({ checks, label }: { checks: PrCheck[]; label: string }) {
	return (
		<HoverList className="checks-grid" itemSelector="[data-check]" aria-label={label}>
			{checks.map((check) => (
				<CheckRow key={check.id ?? check.name} check={check} />
			))}
		</HoverList>
	);
}

/** The checks that were skipped, folded into one quiet row that opens to list them. */
function SkippedChecks({ checks }: { checks: PrCheck[] }) {
	return (
		<Collapsible className="checks-skipped">
			<CollapsibleTrigger asChild>
				<Button variant="quiet" className="checks-skipped-toggle">
					{checks.length} skipped
					<ChevronDown aria-hidden className="checks-chevron" />
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<CheckGrid checks={checks} label="Skipped checks" />
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * Every check of the head commit under the strip that opens it. Failed come
 * first, then those that still run, then those that passed, across the
 * columns row by row; skipped checks fold into one row at the end.
 */
export function ChecksList({ view }: { view: PullChecksView }) {
	if (view.phase !== 'ready') return null;

	const skipped = view.checks.filter((check) => check.state === 'skipped');
	const listed = view.checks.filter((check) => check.state !== 'skipped');

	return (
		<CollapsibleContent>
			<ScrollArea className="checks-list" viewportClassName="checks-list-viewport">
				{listed.length > 0 ? <CheckGrid checks={listed} label="Checks" /> : null}
				{skipped.length > 0 ? <SkippedChecks checks={skipped} /> : null}
			</ScrollArea>
		</CollapsibleContent>
	);
}
