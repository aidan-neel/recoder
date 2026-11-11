import { z } from 'zod';
import { LIST_FLAGS, REPORT_FLAGS } from '../args/flags.js';
import { parseFlags } from '../args/parse.js';
import { parseRunsQuery, resultOutput } from '../args/run-args.js';
import { CliError, EXIT } from '../exit.js';
import type { ReportDestination } from '../output/deliver.js';
import { writeStderrLine } from '../output/streams.js';
import { cancelRun } from '../runs/cancel-run.js';
import { listRecentRuns, writeWarnings } from '../runs/list-command.js';
import { deliverRunResult } from '../runs/result-command.js';
import { parseRunId, type RunId } from '../runs/run-id.js';
import { readRunStatus } from '../runs/run-status.js';
import { waitForRun } from '../runs/wait-for-run.js';
import { PLAIN_SURFACE } from '../terminal/surface.js';
import { describeFlag, flagArgv, flagProperties, type FlagArguments } from './flag-arguments.js';
import {
	defineTool,
	failedCommandResult,
	jsonResult,
	textResult,
	type ToolCallContext,
	type ToolResult
} from './tool.js';

/** Under the 60 seconds many agents allow one tool call, so a wait returns before the agent gives up on it. */
const DEFAULT_WAIT_SECONDS = 45;

/** The longest one wait may take; an agent with a longer tool limit still polls now and then. */
const MAX_WAIT_SECONDS = 600;

const MS_PER_SECOND = 1000;

/**
 * The report flags `recoder_result` leaves out: `output` writes a file on the server's side, and `fail-on` only
 * changes an exit code, which a tool result does not have.
 */
const RESULT_LEFT_OUT_FLAGS = ['output', 'fail-on'] as const satisfies readonly (keyof typeof REPORT_FLAGS)[];

/** `limit` is a number here, where the command line takes its text; the help row describes it all the same. */
const LIMIT_PROPERTY = z.int().min(LIST_FLAGS.limit.bounds.min).optional().describe(describeFlag(LIST_FLAGS, 'limit'));

const runIdProperty = z.string().describe('The runId recoder_review returned, such as 20261110-153045-a1b2c3.');

const runInput = z.object({ runId: runIdProperty }).strict();

export const waitTool = defineTool({
	name: 'recoder_wait',
	description: [
		'Waits until a run ends or timeoutSeconds pass, then returns its status as JSON.',
		`timeoutSeconds defaults to ${DEFAULT_WAIT_SECONDS} and may be at most ${MAX_WAIT_SECONDS}.`,
		'Call it again while state is running. Once state is not running, call recoder_result.'
	].join(' '),
	input: z
		.object({
			runId: runIdProperty,
			timeoutSeconds: z.int().min(1).max(MAX_WAIT_SECONDS).optional().describe('Seconds to wait at most.')
		})
		.strict(),
	run: async ({ runId, timeoutSeconds = DEFAULT_WAIT_SECONDS }, { environment, signal }) => {
		const timeoutMs = timeoutSeconds * MS_PER_SECOND;

		return jsonResult(await waitForRun({ runId: parseRunId(runId), timeoutMs, signal, clock: environment.clock }));
	}
});

export const statusTool = defineTool({
	name: 'recoder_status',
	description:
		"Returns a run's status as JSON at once, without waiting: { runId, state (running, complete, failed or cancelled), stage, findings, unconfirmed, exitCode, error, reportFile, logFile and more }.",
	input: runInput,
	run: async ({ runId }) => jsonResult(await readRunStatus(parseRunId(runId)))
});

export const resultTool = defineTool({
	name: 'recoder_result',
	description: [
		"Returns a finished run's report as JSON or markdown, filtered by min-severity and include-unconfirmed; the stored report keeps everything.",
		'Call it once recoder_wait returns a state other than running. A run that ended without a report returns its error.'
	].join(' '),
	input: z.object({ ...flagProperties(REPORT_FLAGS, RESULT_LEFT_OUT_FLAGS), runId: runIdProperty }).strict(),
	run: async ({ runId, ...flags }, context) => readResult(parseRunId(runId), flags, context)
});

export const cancelTool = defineTool({
	name: 'recoder_cancel',
	description:
		'Asks a running review to stop and returns its status as JSON with stopRequested. A run that is not running is left as it is.',
	input: runInput,
	run: async ({ runId }, context) => cancelReview(parseRunId(runId), context)
});

export const runsTool = defineTool({
	name: 'recoder_runs',
	description:
		'Lists recent runs as a JSON array of statuses, newest first. Use it to find a runId again; repo keeps the runs of one repository.',
	input: z.object({ ...flagProperties(LIST_FLAGS, ['limit']), limit: LIMIT_PROPERTY }).strict(),
	run: async ({ limit, ...flags }, context) => findRuns({ ...flags, limit: limit?.toString() }, context)
});

/** The report as `recoder result` writes it, with the same flags checked the same way, collected instead of printed. */
async function readResult(runId: RunId, flags: FlagArguments, context: ToolCallContext): Promise<ToolResult> {
	const values = parseFlags(flagArgv(flags), { options: REPORT_FLAGS, strict: true, allowPositionals: false });
	const output = resultOutput(values, context.environment.workingDirectory, 'program');

	const written: string[] = [];
	const result = await deliverRunResult(runId, output, collectInto(written));

	return result.kind === 'report' ? textResult(written.join('')) : failedCommandResult(result.error);
}

/** A destination that keeps the report's text. The tool never sets `output`, so no file is ever written. */
function collectInto(written: string[]): ReportDestination {
	return {
		writeStdout: async (text) => {
			written.push(text);
		},
		writeFile: async (path) => {
			throw new Error(`recoder_result writes no files; asked to write ${path}`);
		},
		writeNote: writeStderrLine,
		out: PLAIN_SURFACE,
		err: PLAIN_SURFACE
	};
}

/**
 * A run this server is still starting is stopped here: its record names this server's own process, and signalling
 * that would end the server and every start in it. Any other run's process is asked to stop as `recoder cancel` asks.
 */
async function cancelReview(runId: RunId, context: ToolCallContext): Promise<ToolResult> {
	if (await context.starts.cancel(runId)) return jsonResult({ ...(await readRunStatus(runId)), stopRequested: true });

	return jsonResult(await cancelRun(runId, (pid) => stopOtherProcess(pid, context)));
}

/** Never signals this server: a run that still names it is between its creation and its listing as pending. */
function stopOtherProcess(pid: number, context: ToolCallContext): void {
	if (pid === process.pid) {
		throw new CliError('the run is still starting in this server; call recoder_cancel again.', EXIT.failed);
	}

	context.environment.stopProcess(pid);
}

/** The runs `recoder runs` lists for the same flags; `repo` resolves against the server's working directory. */
async function findRuns(flags: FlagArguments, context: ToolCallContext): Promise<ToolResult> {
	const query = parseRunsQuery(flagArgv(flags), context.environment.workingDirectory);
	const { statuses, warnings } = await listRecentRuns(query);

	writeWarnings(warnings);

	return jsonResult(statuses);
}
