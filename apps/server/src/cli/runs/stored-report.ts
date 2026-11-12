import { z } from 'zod';
import { CliError, EXIT } from '../exit.js';
import { SEVERITIES } from '../output/severity.js';
import { REPORT_SCHEMA_VERSION, type ReviewReport } from '../report/report.js';
import type { RunId } from './run-id.js';
import { parseJson, readTextIfPresent, writeFileAtomically, type RunFiles } from './run-files.js';

const text = z.string();

const optionalText = z.string().optional();

const nullableText = z.string().nullable();

const severity = z.string().refine((value) => SEVERITIES.some((known) => known === value));

/**
 * The finding fields `markdown-finding.ts`, `select.ts` and `exit-code.ts` read, optional where `Finding` makes them
 * optional: a file-level finding has no `line`.
 */
const findingShape = z.looseObject({
	file: text,
	line: z.number().optional(),
	endLine: z.number().optional(),
	severity,
	message: text,
	title: optionalText,
	category: optionalText,
	suggestion: optionalText,
	verification: z
		.looseObject({
			status: z.enum(['verified', 'unverified']),
			reason: text,
			method: optionalText,
			command: optionalText
		})
		.optional(),
	patch: z.looseObject({ diff: text, checks: z.array(text) }).optional()
});

/** The report fields `markdown.ts`, `deliver.ts` and `exit-code.ts` read; the JSON renderer writes the rest as it is. */
const reportShape = z.looseObject({
	schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
	outcome: z.enum(['complete', 'failed', 'cancelled']),
	summary: text,
	error: nullableText,
	target: z.looseObject({
		kind: text,
		base: nullableText,
		head: nullableText,
		headSha: nullableText,
		url: nullableText,
		repoPath: nullableText,
		changedFiles: z.number()
	}),
	settings: z.looseObject({
		budget: text,
		subagents: z.union([z.number(), text]),
		reviewerModel: nullableText,
		workerModel: nullableText,
		verifierModel: nullableText.optional(),
		reviewerEffort: nullableText,
		workerEffort: nullableText,
		lenses: z.array(text).nullable(),
		reportLowSeverity: z.boolean(),
		exec: z.boolean(),
		execReason: nullableText
	}),
	findings: z.array(findingShape),
	unconfirmed: z.array(findingShape),
	recommendedChecks: z.array(text),
	coverage: z.looseObject({
		reviewed: z.number(),
		partial: z.number(),
		pending: z.number(),
		excluded: z.number(),
		total: z.number()
	}),
	coverageGaps: z.array(z.looseObject({ path: text, state: text, reason: text })),
	durationMs: z.number()
});

/**
 * `report.json` is written by this program, but it is read back from disk, so it is checked before use: every field
 * the output code reads is checked, with the optionality its type has, and the rest is passed through as it is. That
 * catches a cut-short file, one from another version, or one edited by hand, before a renderer trips on it.
 */
const storedReportSchema = z.custom<ReviewReport>((value) => reportShape.safeParse(value).success);

export async function saveReport(files: RunFiles, report: ReviewReport): Promise<void> {
	await writeFileAtomically(files.report, `${JSON.stringify(report)}\n`);
}

/** The run's saved report; null when it has none. */
export async function readStoredReport(runId: RunId, files: RunFiles): Promise<ReviewReport | null> {
	const text = await readTextIfPresent(files.report);

	if (text === null) return null;

	const parsed = storedReportSchema.safeParse(parseJson(text, (reason) => unreadableReport(runId, reason)));

	if (!parsed.success) throw unreadableReport(runId, 'it is not a report this version can read');

	return parsed.data;
}

function unreadableReport(runId: RunId, reason: string): CliError {
	return new CliError(`run ${runId} has an unreadable report.json: ${reason}`, EXIT.failed);
}
