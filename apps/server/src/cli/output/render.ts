import type { ReviewReport } from '../report/report.js';
import type { ReportFormat } from '../review/options.js';
import type { Surface } from '../terminal/surface.js';
import { renderMarkdown } from './markdown.js';
import { renderTextReport } from './text-report.js';

const JSON_INDENT = 2;

/** The report in the format asked for; only `text` is styled for the surface it is written to. */
export function renderReport(report: ReviewReport, format: ReportFormat, surface: Surface): string {
	if (format === 'markdown') return renderMarkdown(report);

	if (format === 'text') return renderTextReport(report, surface);

	return JSON.stringify(report, null, JSON_INDENT);
}
