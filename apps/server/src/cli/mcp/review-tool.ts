import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { REVIEW_FLAGS } from '../args/flags.js';
import { backgroundFlags } from '../args/launch.js';
import { parseReviewArgs } from '../args/review-args.js';
import { describeError, errorCode, usageError } from '../exit.js';
import type { ReviewOptions } from '../review/options.js';
import { HANDOVER_TIMEOUT_MS, detachReview, type DetachedRun } from '../runs/detach.js';
import { flagArgv, flagProperties, type FlagArguments } from './flag-arguments.js';
import { defineTool, failedResult, jsonResult, type ToolCallContext, type ToolResult } from './tool.js';

type ReviewFlag = keyof typeof REVIEW_FLAGS;

/**
 * The `recoder review` flags the tool leaves out. `detach`: the tool always starts a background run. `output` and
 * `progress`: nothing reads a background run's file or progress here. `format`, `min-severity`,
 * `include-unconfirmed` and `fail-on`: they shape the written report, which `recoder_result` writes. The internal
 * `--run-id` has no help row, so it is never a property.
 */
const LEFT_OUT_FLAGS = [
	'detach',
	'output',
	'progress',
	'format',
	'min-severity',
	'include-unconfirmed',
	'fail-on'
] as const satisfies readonly ReviewFlag[];

/**
 * The flags whose value is a file the review reads. The command line reads them with a blocking read, and a pipe or a
 * device such as `/dev/stdin` would hold the server on the protocol stream, so each must name a regular file.
 */
const FILE_FLAGS = ['diff', 'body-file', 'instructions-file'] as const satisfies readonly ReviewFlag[];

const DETACH_FLAG = '--detach';

/** `--diff -` reads standard input, which carries the protocol here. */
const STANDARD_INPUT = '-';

/** The CLI's `--diff` help offers standard input, which the tool refuses, so the tool describes `diff` itself. */
const DIFF_PROPERTY = z
	.string()
	.optional()
	.describe('--diff <file>: Review a unified diff from a file. No code runs. - (standard input) is not accepted here.');

const DESCRIPTION = [
	'Starts a Recoder review of a code change in the background and returns its status as JSON, with its runId.',
	'A review takes 5 to 40 minutes.',
	'Next, call recoder_wait with the runId until state is not running, then call recoder_result.',
	'Each property stands for the command-line flag its description starts with: a boolean for a flag without a value, a list for a repeatable one, and a string otherwise.',
	'With no target property, it reviews the commits on the current branch since the default branch.',
	"The repository is the server's working directory unless repo is given.",
	"Relative paths resolve against the server's working directory.",
	'diff, body-file and instructions-file must each name a regular file.',
	'isError is true when the review did not start: read error and logFile in the status.'
].join(' ');

export const reviewTool = defineTool({
	name: 'recoder_review',
	description: DESCRIPTION,
	input: z.object({ ...flagProperties(REVIEW_FLAGS, LEFT_OUT_FLAGS), diff: DIFF_PROPERTY }).strict(),
	run: startReview
});

/**
 * Starts the review as `recoder review --detach` does: the arguments become its flags and go through the same
 * parsing, and a background process runs the review, so this server never loads the pipeline.
 */
async function startReview(input: FlagArguments, context: ToolCallContext): Promise<ToolResult> {
	const { workingDirectory } = context.environment;

	await requireRegularFiles(input, workingDirectory);

	const { options, launch } = parseReviewArgs([...flagArgv(input), DETACH_FLAG], workingDirectory);

	if (launch.kind !== 'detach') throw new Error(`the review arguments started a ${launch.kind} review`);

	const { status, outcome } = await detachWhileCalled(options, launch.flags, context);

	return outcome === 'started' ? jsonResult(status) : failedResult(JSON.stringify(status));
}

/** Refuses a file argument that is standard input or anything but a regular file, before anything reads it. */
async function requireRegularFiles(input: FlagArguments, workingDirectory: string): Promise<void> {
	for (const name of FILE_FLAGS) {
		const value = input[name];

		if (typeof value !== 'string') continue;

		if (value === STANDARD_INPUT) {
			throw usageError(`${name} cannot be - here: standard input carries the protocol. Save it to a file.`);
		}

		await requireRegularFile(name, resolve(workingDirectory, value));
	}
}

/** `stat` follows symbolic links, so a link to a pipe or a device is refused as well. */
async function requireRegularFile(name: string, path: string): Promise<void> {
	const found = await stat(path).catch((error: unknown) => {
		if (errorCode(error) === 'ENOENT') throw usageError(`${name} names ${path}, which does not exist.`);

		throw usageError(`${name} cannot check ${path}: ${describeError(error)}`);
	});

	if (!found.isFile()) throw usageError(`${name} must name a regular file; ${path} is not one.`);
}

/**
 * Starts the background review with a stop of its own, linked to the call and listed in the server's pending starts
 * only until `detachReview` returns. `detachReview` passes every stop on to the review for as long as its listener
 * lives, so a cancel or a server stop during the handover stops the review, and one after it cannot reach a review
 * that has started.
 */
async function detachWhileCalled(
	options: ReviewOptions,
	flags: readonly string[],
	context: ToolCallContext
): Promise<DetachedRun> {
	const { environment, signal, starts } = context;
	const handover = new AbortController();
	const stopHandover = (): void => handover.abort();
	let endPending = (): void => {};

	signal.addEventListener('abort', stopHandover, { once: true });

	if (signal.aborted) stopHandover();

	try {
		return await detachReview({
			run: { repoPath: options.repoPath, targetKind: options.target.kind },
			command: (runId) => [...environment.reviewCommand, ...backgroundFlags(runId, flags)],
			signal: handover.signal,
			handoverTimeoutMs: HANDOVER_TIMEOUT_MS,
			spawn: environment.spawn,
			onRunCreated: (runId) => {
				endPending = starts.add(runId, handover);
			}
		});
	} finally {
		signal.removeEventListener('abort', stopHandover);
		endPending();
	}
}
