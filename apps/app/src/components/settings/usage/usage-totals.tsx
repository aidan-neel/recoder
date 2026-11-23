import { formatCompact, formatShare, StackedBar } from '@recoder/ui';
import type { ReactNode } from 'react';

import { failureKinds } from '@/lib/metrics/error-kinds';
import {
	failureRate,
	formatCost,
	formatDuration,
	tokenSegments,
	uncachedInput,
	type UsageScope
} from '@/lib/usage/usage-model';

import { UsageBlock } from './usage-block';

interface FigureProps {
	label: string;
	/** Colors the figure to flag it; only a failure rate above zero sets it. */
	tone?: 'warning';
	children: ReactNode;
}

export function Figure({ label, tone, children }: FigureProps) {
	return (
		<div className="usage-figure">
			<dt>{label}</dt>
			<dd data-tone={tone}>{children}</dd>
		</div>
	);
}

/**
 * The scope's tokens split every way the report counts them, as figures and
 * then as one bar. One person's view swaps the cache saving, which the report
 * does not split by person, for their share of all tokens.
 */
export function UsageTotals({ scope }: { scope: UsageScope }) {
	const { totals, person } = scope;

	return (
		<>
			<UsageBlock title="Totals">
				<dl className="usage-figures">
					<Figure label="Processed tokens">{formatCompact(totals.tokens)}</Figure>
					<Figure label="Cached input">{formatCompact(totals.cacheRead)}</Figure>
					<Figure label="Uncached input">{formatCompact(uncachedInput(totals))}</Figure>
					<Figure label="Output">{formatCompact(totals.output)}</Figure>
					{person ? (
						<Figure label="Of all tokens">{formatShare(person.share)}</Figure>
					) : (
						<Figure label="Cache savings">{formatCost(scope.cacheSavingsUsd)}</Figure>
					)}
				</dl>
			</UsageBlock>
			<UsageBlock title="Tokens by type">
				<StackedBar
					className="usage-types"
					segments={tokenSegments(totals)}
					formatValue={formatCompact}
					aria-label="Tokens by type"
				/>
			</UsageBlock>
		</>
	);
}

/**
 * The scope's model calls: how many, how many failed (with the rate, in the
 * warning color once any did) and the typical time one took, then the failures by kind of error.
 */
export function UsageCalls({ scope }: { scope: UsageScope }) {
	const { totals } = scope;
	const rate = failureRate(totals);
	const kinds = failureKinds(totals.failedByKind);

	return (
		<UsageBlock title="Model calls">
			<dl className="usage-figures">
				<Figure label="Calls">{formatCompact(totals.calls)}</Figure>
				<Figure label="Failed" tone={totals.failedCalls > 0 ? 'warning' : undefined}>
					{formatCompact(totals.failedCalls)}
					<span className="usage-figure-quiet">{rate === null ? '—' : formatShare(rate)}</span>
				</Figure>
				<Figure label="Typical time">{formatDuration(totals.medianDurationMs)}</Figure>
			</dl>
			{kinds.length > 0 ? (
				<p className="meta usage-failure-kinds">
					Failed calls: {kinds.map(({ label, count }) => `${label} ${formatCompact(count)}`).join(' · ')}
				</p>
			) : null}
		</UsageBlock>
	);
}
