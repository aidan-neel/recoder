import { resolve } from 'node:path';
import { REASONING_EFFORTS, TOKEN_BUDGETS } from '@recoder/shared';
import type { Audience } from '../audience.js';
import type { OutputOptions, ReviewIntent, ReviewOptions, ReviewScope, ReviewTuning } from '../review/options.js';
import {
	OUTPUT_DEFAULTS,
	PROGRESS_FORMATS,
	REVIEW_DEFAULTS,
	REVIEW_FLAGS,
	REVIEW_PARSE_CONFIG,
	type ReviewFlagValues
} from './flags.js';
import { parseLenses, parseLevers, rejectMoreThanOne } from './lists.js';
import { parseFlags } from './parse.js';
import { resolveLaunch, type ReviewLaunch } from './launch.js';
import { resolveReportOutput } from './report-output.js';
import { selectTarget } from './target.js';
import {
	parseChoice,
	normalizeText,
	parseChoiceOr,
	parseSubagents,
	parseText,
	parseTimeoutMs,
	parseWholeNumber,
	readTextFile,
	requireText
} from './values.js';

/** One `recoder review`: the options it runs with and how it is started. */
export interface ReviewRequest {
	options: ReviewOptions;
	launch: ReviewLaunch;
}

/**
 * Reads the argv of `recoder review` into the options one review runs with and how it starts. Every flag is checked
 * here, so a bad one is reported before anything starts, in the foreground or the background. `audience` decides how
 * the report and progress are written when no flag does. Throws a `CliError`.
 */
export function parseReviewArgs(argv: string[], workingDirectory: string, audience: Audience): ReviewRequest {
	const values = parseFlags(argv, REVIEW_PARSE_CONFIG);
	const options = resolveReviewOptions(values, workingDirectory, audience);

	return { options, launch: resolveLaunch(values, options.target, argv) };
}

function resolveReviewOptions(values: ReviewFlagValues, workingDirectory: string, audience: Audience): ReviewOptions {
	return {
		repoPath: resolve(workingDirectory, parseText('--repo', values.repo) ?? '.'),
		target: selectTarget(values),
		scope: resolveScope(values),
		intent: resolveIntent(values, workingDirectory),
		tuning: resolveTuning(values),
		output: resolveOutput(values, workingDirectory, audience),
		timeoutMs: parseTimeoutMs(values.timeout),
		keepCheckout: values['keep-checkout'] === true
	};
}

function resolveScope(values: ReviewFlagValues): ReviewScope {
	return {
		include: (values.include ?? []).map((glob) => requireText('--include', glob)),
		exclude: (values.exclude ?? []).map((glob) => requireText('--exclude', glob))
	};
}

/**
 * The change's title, body and instructions; the body and the instructions each come inline or from a file. Each is
 * trimmed and a blank one is not given, so the review never gets empty intent text.
 */
function resolveIntent(values: ReviewFlagValues, workingDirectory: string): ReviewIntent {
	rejectMoreThanOne(values, ['body', 'body-file']);
	rejectMoreThanOne(values, ['instructions', 'instructions-file']);

	return {
		title: normalizeText(values.title),
		body: normalizeText(textOrFile('--body-file', values.body, values['body-file'], workingDirectory)),
		instructions: normalizeText(
			textOrFile('--instructions-file', values.instructions, values['instructions-file'], workingDirectory)
		)
	};
}

/** Text given inline, or read from the file given instead; null when neither is. */
function textOrFile(
	fileFlag: string,
	inline: string | undefined,
	file: string | undefined,
	workingDirectory: string
): string | null {
	if (file !== undefined) return readTextFile(fileFlag, file, workingDirectory);

	return inline ?? null;
}

function resolveTuning(values: ReviewFlagValues): ReviewTuning {
	return {
		budget: parseChoice('--budget', values.budget ?? REVIEW_DEFAULTS.budget, TOKEN_BUDGETS),
		subagents: parseSubagents(values.subagents, REVIEW_FLAGS.subagents.bounds),
		reviewerModel: parseText('--reviewer', values.reviewer),
		workerModel: parseText('--worker', values.worker),
		reviewerEffort: parseChoiceOr('--reviewer-effort', values['reviewer-effort'], REASONING_EFFORTS, null),
		workerEffort: parseChoiceOr('--worker-effort', values['worker-effort'], REASONING_EFFORTS, null),
		lenses: parseLenses(values),
		reportLowSeverity: resolveLowSeverity(values),
		exec: values['no-exec'] !== true,
		baselineCache: values['no-baseline-cache'] !== true,
		maxFileChars: parseMaxFileChars(values['max-file-chars']),
		levers: parseLevers(values.enable)
	};
}

/** `--low-severity` keeps low-severity findings, `--no-low-severity` drops them, neither leaves it to the saved setting. */
function resolveLowSeverity(values: ReviewFlagValues): boolean | null {
	rejectMoreThanOne(values, ['low-severity', 'no-low-severity']);

	if (values['low-severity'] !== undefined) return true;

	return values['no-low-severity'] === undefined ? null : false;
}

function parseMaxFileChars(value: string | undefined): number | null {
	if (value === undefined) return null;

	return parseWholeNumber('--max-file-chars', value, REVIEW_FLAGS['max-file-chars'].bounds);
}

function resolveOutput(values: ReviewFlagValues, workingDirectory: string, audience: Audience): OutputOptions {
	return {
		...resolveReportOutput(values, workingDirectory, audience),
		progress: parseChoice('--progress', values.progress ?? OUTPUT_DEFAULTS[audience].progress, PROGRESS_FORMATS)
	};
}
