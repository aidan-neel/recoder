'use client';

import { StatusNotice } from '@recoder/ui';

import { isEmptyTelemetry } from '@/lib/telemetry/telemetry-model';
import { useTelemetrySection } from '@/lib/telemetry/use-telemetry-section';

import { SectionNotice } from '../section-notice';
import { TelemetryReportView } from './telemetry-report-view';
import { TelemetrySkeleton } from './telemetry-skeleton';

/** Settings → Telemetry: pull requests reviewed, merged, findings triaged and average tokens per review. */
export function TelemetrySection() {
	return (
		<div className="usage-page">
			<TelemetryBody />
		</div>
	);
}

function TelemetryBody() {
	const section = useTelemetrySection();

	if (section.view === 'loading') return <TelemetrySkeleton />;

	if (section.view === 'failed') {
		return <SectionNotice what="Telemetry" error={section.error} retry={section.retry} />;
	}

	if (isEmptyTelemetry(section.report)) {
		return (
			<div className="page-notice">
				<StatusNotice variant="section" heading="h2" title={`No reviews in the last ${section.report.days} days`} />
			</div>
		);
	}

	return <TelemetryReportView report={section.report} />;
}
