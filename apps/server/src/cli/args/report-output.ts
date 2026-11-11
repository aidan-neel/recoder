import { resolve } from 'node:path';
import { SEVERITIES } from '../output/severity.js';
import type { OutputOptions } from '../review/options.js';
import { FAIL_ON_CHOICES, REPORT_FORMATS, REVIEW_DEFAULTS, type ReportFlagValues } from './flags.js';
import { parseChoice, parseText } from './values.js';

/** How a report is written, from the flags `recoder review` and `recoder result` share; progress is the caller's. */
export function resolveReportOutput(
	values: ReportFlagValues,
	workingDirectory: string
): Omit<OutputOptions, 'progress'> {
	const file = parseText('--output', values.output);

	return {
		format: parseChoice('--format', values.format ?? REVIEW_DEFAULTS.format, REPORT_FORMATS),
		file: file === null ? null : resolve(workingDirectory, file),
		minSeverity: parseChoice('--min-severity', values['min-severity'] ?? REVIEW_DEFAULTS.minSeverity, SEVERITIES),
		includeUnconfirmed: values['include-unconfirmed'] === true,
		failOn: parseChoice('--fail-on', values['fail-on'] ?? REVIEW_DEFAULTS.failOn, FAIL_ON_CHOICES)
	};
}
