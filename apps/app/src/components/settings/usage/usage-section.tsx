'use client';

import { StatusNotice } from '@recoder/ui';

import { isEmpty } from '@/lib/usage/usage-model';
import { useUsageSection } from '@/lib/usage/use-usage-section';

import { SectionNotice } from '../section-notice';
import { UsageReportView } from './usage-report-view';
import { UsageSkeleton } from './usage-skeleton';

/** Settings → Usage: how many tokens each person and model used, for the admin. */
export function UsageSection() {
	return (
		<div className="usage-page">
			<UsageBody />
		</div>
	);
}

function UsageBody() {
	const section = useUsageSection();

	if (section.view === 'loading') return <UsageSkeleton />;

	if (section.view === 'failed') return <SectionNotice what="Usage" error={section.error} retry={section.retry} />;

	if (isEmpty(section.report)) {
		return (
			<div className="page-notice">
				<StatusNotice variant="section" heading="h2" title={`No usage in the last ${section.report.days} days`} />
			</div>
		);
	}

	return <UsageReportView report={section.report} />;
}
