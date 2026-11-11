import { EXIT, type ExitCode } from '../exit.js';
import type { OutputOptions } from '../review/options.js';
import type { ReviewReport } from '../report/report.js';
import { selectWritten } from './select.js';
import { meetsSeverity } from './severity.js';

/** The code the process exits with. Only a written, confirmed finding at or above `failOn` makes a complete review exit 1. */
export function exitCodeFor(report: ReviewReport, output: OutputOptions): ExitCode {
	if (report.outcome === 'cancelled') return EXIT.cancelled;

	if (report.outcome === 'failed') return EXIT.failed;

	const { failOn } = output;

	if (failOn === 'never') return EXIT.ok;

	const tripped = selectWritten(report, output).findings.some((finding) => meetsSeverity(finding.severity, failOn));

	return tripped ? EXIT.findings : EXIT.ok;
}
