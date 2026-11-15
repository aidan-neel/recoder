import { formatShare, StackedBar } from '@recoder/ui';

import {
	acceptanceRate,
	autoReviewShare,
	dismissalRate,
	formatAvgTokens,
	mergeRate,
	severitySegments,
	type TelemetryScope
} from '@/lib/telemetry/telemetry-model';
import { formatWhole } from '@/lib/usage/report-shared';

import { UsageBlock } from '../usage/usage-block';
import { Figure } from '../usage/usage-totals';

function quietRate(rate: number | null): string {
	return rate === null ? '—' : formatShare(rate);
}

/** Pull request, review and average-tokens-per-review summary figures for the current scope. */
export function TelemetryPullRequests({ scope }: { scope: TelemetryScope }) {
	const { totals } = scope;

	return (
		<UsageBlock title="Pull requests">
			<dl className="usage-figures">
				<Figure label="PRs reviewed">{formatWhole(totals.prsReviewed)}</Figure>
				<Figure label="PRs merged">
					{formatWhole(totals.prsMerged)}
					<span className="usage-figure-quiet">{quietRate(mergeRate(totals))}</span>
				</Figure>
				<Figure label="Reviews">{formatWhole(totals.reviews)}</Figure>
				<Figure label="Auto reviews">
					{formatWhole(totals.autoReviews)}
					<span className="usage-figure-quiet">{quietRate(autoReviewShare(totals))}</span>
				</Figure>
				<Figure label="Avg tokens / review">{formatAvgTokens(totals.avgTokensPerReview)}</Figure>
			</dl>
		</UsageBlock>
	);
}

/** Finding triage, commit-check blocking, fixed-on-rereview figures and severity stacked bar. */
export function TelemetryFindings({ scope }: { scope: TelemetryScope }) {
	const { totals } = scope;

	return (
		<>
			<UsageBlock title="Findings">
				<dl className="usage-figures">
					<Figure label="Raised">{formatWhole(totals.findings)}</Figure>
					<Figure label="Accepted">
						{formatWhole(totals.findingsAccepted)}
						<span className="usage-figure-quiet">{quietRate(acceptanceRate(totals))}</span>
					</Figure>
					<Figure label="Dismissed">
						{formatWhole(totals.findingsDismissed)}
						<span className="usage-figure-quiet">{quietRate(dismissalRate(totals))}</span>
					</Figure>
					<Figure label="Blocking">{formatWhole(totals.findingsBlocking)}</Figure>
					<Figure label="Fixed">{formatWhole(totals.findingsResolved)}</Figure>
				</dl>
			</UsageBlock>
			<UsageBlock title="Findings by severity">
				<StackedBar
					className="usage-types"
					segments={severitySegments(totals)}
					formatValue={formatWhole}
					aria-label="Findings by severity"
				/>
			</UsageBlock>
		</>
	);
}
