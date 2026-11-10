import type { ReviewReport } from '../report/report.js';
import type { ReportFormat } from '../review/options.js';
import { renderMarkdown } from './markdown.js';

const JSON_INDENT = 2;

/** The report in the format asked for. */
export function renderReport(report: ReviewReport, format: ReportFormat): string {
	if (format === 'markdown') return renderMarkdown(report);

	return JSON.stringify(report, null, JSON_INDENT);
}
