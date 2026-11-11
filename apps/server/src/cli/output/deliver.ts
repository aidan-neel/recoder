import type { Stats } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CliError, EXIT, describeError, errorCode, usageError } from '../exit.js';
import type { OutputOptions } from '../review/options.js';
import type { ReviewReport } from '../report/report.js';
import { tildePath } from '../terminal/home-path.js';
import { PLAIN_SURFACE, type Surface } from '../terminal/surface.js';
import type { Terminal } from '../terminal/terminal.js';
import { plural } from '../terminal/text.js';
import { renderReport } from './render.js';
import { selectWritten } from './select.js';
import { writeStderrLine, writeStdout } from './streams.js';

/** Where the report goes; injected so tests need neither the terminal nor the disk. */
export interface ReportDestination {
	writeStdout: (text: string) => Promise<void>;
	writeFile: (path: string, text: string) => Promise<void>;
	/** Tells a person something beside the report, on standard error. */
	writeNote: (line: string) => void;
	/** Standard output as a `text` report is styled for it, and standard error as a note is. */
	out: Surface;
	err: Surface;
}

/** The destination the command line uses: standard output, the file system, and the terminal's surfaces. */
export function processDestination(terminal: Terminal): ReportDestination {
	return {
		writeStdout,
		writeFile: (path, text) => writeFile(path, text),
		writeNote: writeStderrLine,
		out: terminal.out,
		err: terminal.err
	};
}

/**
 * Checks that `--output` can be written before the review spends anything on a report it could not save, and
 * creates the folders above it.
 */
export async function prepareOutputFile(file: string): Promise<void> {
	await mkdir(dirname(file), { recursive: true }).catch((error: unknown) => {
		throw usageError(`--output cannot create the folder for ${file}: ${describeError(error)}`);
	});

	const existing = await statIfPresent(file);

	if (existing?.isDirectory()) throw usageError(`--output ${file} is a directory; name a file.`);
}

/** The file's status, or null when it does not exist yet; any other failure is a usage error naming the path. */
async function statIfPresent(file: string): Promise<Stats | null> {
	try {
		return await stat(file);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;

		throw usageError(`--output cannot check ${file}: ${describeError(error)}`);
	}
}

/**
 * Writes the filtered report to standard output, or to `output.file`. A file never holds terminal styling. What
 * stands in for the report then depends on who reads: a program gets a one-line JSON receipt on standard output, so
 * an agent that asked for a file does not read the report twice, and a person gets one line saying where it went.
 */
export async function deliverReport(
	report: ReviewReport,
	output: OutputOptions,
	destination: ReportDestination
): Promise<void> {
	const written = selectWritten(report, output);

	if (output.file === null) {
		await destination.writeStdout(withTrailingNewline(renderReport(written, output.format, destination.out)));

		return;
	}

	const text = withTrailingNewline(renderReport(written, output.format, PLAIN_SURFACE));

	await destination.writeFile(output.file, text).catch((error: unknown) => {
		throw new CliError(`cannot write the report to ${output.file}: ${describeError(error)}`, EXIT.failed);
	});

	if (output.audience === 'program') {
		await destination.writeStdout(`${JSON.stringify(receiptFor(written, output.file))}\n`);

		return;
	}

	destination.writeNote(noteFor(written, output.file, destination.err));
}

/** What stands in for the report on standard output when it went to a file. */
interface ReportReceipt {
	schemaVersion: ReviewReport['schemaVersion'];
	outcome: ReviewReport['outcome'];
	findings: number;
	unconfirmed: number;
	reportFile: string;
}

function receiptFor(written: ReviewReport, reportFile: string): ReportReceipt {
	return {
		schemaVersion: written.schemaVersion,
		outcome: written.outcome,
		findings: written.findings.length,
		unconfirmed: written.unconfirmed.length,
		reportFile
	};
}

/** `✓ Review complete · 2 findings · written to review.md`. */
function noteFor(written: ReviewReport, reportFile: string, { paint, glyphs }: Surface): string {
	const mark = written.outcome === 'complete' ? paint.ok(glyphs.ok) : paint.error(glyphs.fail);

	const facts = [
		`Review ${written.outcome}`,
		plural(written.findings.length, 'finding'),
		`written to ${tildePath(reportFile)}`
	];

	return `${mark} ${facts.join(` ${glyphs.separator} `)}`;
}

function withTrailingNewline(text: string): string {
	return text.endsWith('\n') ? text : `${text}\n`;
}
