import type { OutputOptions } from '../review/options.js';
import type { ReportFinding, ReviewReport } from '../report/report.js';
import { meetsSeverity } from './severity.js';

/** The report as it is written: findings below `minSeverity` are left out and unconfirmed ones only when asked for. */
export function selectWritten(report: ReviewReport, output: OutputOptions): ReviewReport {
	const keep = (finding: ReportFinding): boolean => meetsSeverity(finding.severity, output.minSeverity);

	return {
		...report,
		findings: report.findings.filter(keep),
		unconfirmed: output.includeUnconfirmed ? report.unconfirmed.filter(keep) : []
	};
}
