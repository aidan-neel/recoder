import { formatShare } from '@recoder/ui';

import { formatAvgTokens } from '@/lib/telemetry/telemetry-model';
import { telemetryRowTip, type TelemetryRow } from '@/lib/telemetry/telemetry-rows';
import { formatWhole } from '@/lib/usage/report-shared';

import { ReportTableRow } from '../usage/usage-row';
import { ReportTable, type ReportTableFrameProps } from '../usage/usage-rows';

type TelemetryColumn = 'share' | 'prs' | 'merged' | 'accepted' | 'blocking' | 'dismissed' | 'avg-tokens';

/** The columns after the name, in the order the head and the rows render their cells. */
const HEADINGS: Record<TelemetryColumn, string> = {
	share: 'Share',
	prs: 'PRs',
	merged: 'Merged',
	accepted: 'Accepted',
	blocking: 'Blocking',
	dismissed: 'Dismissed',
	'avg-tokens': 'Avg tokens'
};

/** Breakdown table for Settings → Telemetry: Person, Repository or Day rows with hover tooltips. */
export function TelemetryRows(props: ReportTableFrameProps<TelemetryRow>) {
	const { rows, onSelectPerson } = props;
	const hasDetail = rows.some((row) => row.showsDetailColumns);
	const hasAvgTokens = rows.some((row) => row.showsAvgTokens);

	const shown: Record<TelemetryColumn, boolean> = {
		share: !hasDetail,
		prs: true,
		merged: hasDetail,
		accepted: hasDetail,
		blocking: hasDetail,
		dismissed: hasDetail,
		'avg-tokens': hasAvgTokens
	};

	return (
		<ReportTable
			{...props}
			headings={HEADINGS}
			shown={shown}
			renderRow={(row, widest) => (
				<TelemetryRowView
					row={row}
					widest={widest}
					hasDetail={hasDetail}
					hasAvgTokens={hasAvgTokens}
					onSelectPerson={onSelectPerson}
				/>
			)}
		/>
	);
}

interface TelemetryRowViewProps {
	row: TelemetryRow;
	widest: number;
	hasDetail: boolean;
	hasAvgTokens: boolean;
	onSelectPerson?: (accountId: string) => void;
}

function TelemetryRowView({ row, widest, hasDetail, hasAvgTokens, onSelectPerson }: TelemetryRowViewProps) {
	return (
		<ReportTableRow row={row} widest={widest} tip={telemetryRowTip(row)} onSelectPerson={onSelectPerson}>
			{!hasDetail ? (
				<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
					{formatShare(row.share)}
				</div>
			) : null}
			<div role="cell" className="usage-cell usage-cell-figure">
				{formatWhole(row.prsReviewed)}
			</div>
			{hasDetail ? (
				<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
					{formatWhole(row.prsMerged)}
				</div>
			) : null}
			{hasDetail ? (
				<div role="cell" className="usage-cell usage-cell-figure">
					{formatWhole(row.findingsAccepted)}
				</div>
			) : null}
			{hasDetail ? (
				<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
					{formatWhole(row.findingsBlocking)}
				</div>
			) : null}
			{hasDetail ? (
				<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
					{formatWhole(row.findingsDismissed)}
				</div>
			) : null}
			{hasAvgTokens ? (
				<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
					{formatAvgTokens(row.avgTokensPerReview)}
				</div>
			) : null}
		</ReportTableRow>
	);
}
