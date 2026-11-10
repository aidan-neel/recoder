import { resolve } from 'node:path';
import { usageError } from '../exit.js';
import type { OutputOptions } from '../review/options.js';
import type { RunsQuery } from '../runs/list-command.js';
import { parseRunId, type RunId } from '../runs/run-id.js';
import { DEFAULT_RUNS_LIMIT, LIST_FLAGS, REPORT_FLAGS, WAIT_FLAGS, type ReportFlagValues } from './flags.js';
import { RUN_COMMAND_HELP } from './help.js';
import { parseCommandLine, parseFlags } from './parse.js';
import { resolveReportOutput } from './report-output.js';
import { parseText, parseTimeoutMs, parseWholeNumber } from './values.js';

/** The commands that read or stop a recorded run. */
export type RunCommand = keyof typeof RUN_COMMAND_HELP;

export const RUN_COMMANDS: readonly RunCommand[] = ['status', 'wait', 'result', 'cancel', 'runs'];

/** What a run command was asked to do. */
export type RunInvocation =
	| { command: 'status'; runId: RunId }
	/** A null timeout waits until the run ends. */
	| { command: 'wait'; runId: RunId; timeoutMs: number | null }
	| { command: 'result'; runId: RunId; output: OutputOptions }
	| { command: 'cancel'; runId: RunId }
	| { command: 'runs'; query: RunsQuery };

export function isRunCommand(command: string): command is RunCommand {
	return RUN_COMMANDS.some((known) => known === command);
}

/** Reads the argv of a run command. Throws a `CliError` for a bad one; `--help` is handled by the caller. */
export function parseRunInvocation(command: RunCommand, argv: string[], workingDirectory: string): RunInvocation {
	switch (command) {
		case 'status':
			return { command, runId: parseRunIdArgument(command, argv, {}).runId };
		case 'cancel':
			return { command, runId: parseRunIdArgument(command, argv, {}).runId };
		case 'wait':
			return parseWait(argv);
		case 'result':
			return parseResult(argv, workingDirectory);
		case 'runs':
			return { command, query: parseRunsQuery(argv, workingDirectory) };
	}
}

function parseWait(argv: string[]): RunInvocation {
	const { runId, values } = parseRunIdArgument('wait', argv, WAIT_FLAGS);

	return { command: 'wait', runId, timeoutMs: parseTimeoutMs(values.timeout) };
}

function parseResult(argv: string[], workingDirectory: string): RunInvocation {
	const { runId, values } = parseRunIdArgument('result', argv, REPORT_FLAGS);

	return { command: 'result', runId, output: resultOutput(values, workingDirectory) };
}

/** How `recoder result` and the MCP result tool write a report: from the report flags, with no progress. */
export function resultOutput(values: ReportFlagValues, workingDirectory: string): OutputOptions {
	return { ...resolveReportOutput(values, workingDirectory), progress: 'none' };
}

/**
 * The flags of `recoder runs`, which the MCP runs tool passes too. `--repo` resolves as `recoder review --repo` does,
 * so it equals the `repoPath` of that repository's runs.
 */
export function parseRunsQuery(argv: string[], workingDirectory: string): RunsQuery {
	const values = parseFlags(argv, { options: LIST_FLAGS, strict: true, allowPositionals: false });
	const repo = parseText('--repo', values.repo);

	const limit =
		values.limit === undefined
			? DEFAULT_RUNS_LIMIT
			: parseWholeNumber('--limit', values.limit, LIST_FLAGS.limit.bounds);

	return { limit, repoPath: repo === null ? null : resolve(workingDirectory, repo) };
}

/** The one run id a command takes, checked before it is used in any path, and the command's flags. */
function parseRunIdArgument<Flags extends Parameters<typeof parseCommandLine>[1]['options']>(
	command: RunCommand,
	argv: string[],
	flags: Flags
) {
	const { values, positionals } = parseCommandLine(argv, { options: flags, strict: true, allowPositionals: true });
	const [runId, ...extra] = positionals;

	if (runId === undefined) throw usageError(`recoder ${command} needs a run id.`);

	if (extra.length > 0) throw usageError(`recoder ${command} takes one run id; got also "${extra.join(' ')}".`);

	return { runId: parseRunId(runId), values };
}
