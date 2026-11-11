import { resolve } from 'node:path';
import type { Audience } from '../audience.js';
import { usageError } from '../exit.js';
import type { OutputOptions } from '../review/options.js';
import type { RunsQuery } from '../runs/list-command.js';
import { parseRunReference, type RunReference } from '../runs/run-reference.js';
import { DEFAULT_RUNS_LIMIT, LIST_FLAGS, REPORT_FLAGS, WAIT_FLAGS, type ReportFlagValues } from './flags.js';
import { parseCommandLine, parseFlags } from './parse.js';
import { resolveReportOutput } from './report-output.js';
import { parseText, parseTimeoutMs, parseWholeNumber } from './values.js';

/** The commands that read or stop a recorded run. */
export const RUN_COMMANDS = ['status', 'wait', 'result', 'cancel', 'runs'] as const;

export type RunCommand = (typeof RUN_COMMANDS)[number];

/** What a run command was asked to do. A run that is not named is the newest one. */
export type RunInvocation =
	| { command: 'status'; run: RunReference }
	/** A null timeout waits until the run ends. */
	| { command: 'wait'; run: RunReference; timeoutMs: number | null }
	| { command: 'result'; run: RunReference; output: OutputOptions }
	| { command: 'cancel'; run: RunReference }
	| { command: 'runs'; query: RunsQuery };

export function isRunCommand(command: string): command is RunCommand {
	return RUN_COMMANDS.some((known) => known === command);
}

/** Reads the argv of a run command. Throws a `CliError` for a bad one; `--help` is handled by the caller. */
export function parseRunInvocation(
	command: RunCommand,
	argv: string[],
	context: { workingDirectory: string; audience: Audience }
): RunInvocation {
	switch (command) {
		case 'status':
			return { command, run: parseRunArgument(command, argv, {}).run };
		case 'cancel':
			return { command, run: parseRunArgument(command, argv, {}).run };
		case 'wait':
			return parseWait(argv);
		case 'result':
			return parseResult(argv, context);
		case 'runs':
			return { command, query: parseRunsQuery(argv, context.workingDirectory) };
	}
}

function parseWait(argv: string[]): RunInvocation {
	const { run, values } = parseRunArgument('wait', argv, WAIT_FLAGS);

	return { command: 'wait', run, timeoutMs: parseTimeoutMs(values.timeout) };
}

function parseResult(argv: string[], context: { workingDirectory: string; audience: Audience }): RunInvocation {
	const { run, values } = parseRunArgument('result', argv, REPORT_FLAGS);

	return { command: 'result', run, output: resultOutput(values, context.workingDirectory, context.audience) };
}

/** How `recoder result` and the MCP result tool write a report: from the report flags, with no progress. */
export function resultOutput(values: ReportFlagValues, workingDirectory: string, audience: Audience): OutputOptions {
	return { ...resolveReportOutput(values, workingDirectory, audience), progress: 'none' };
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

/** The one run a command takes, checked before anything reads the disk, and the command's flags. */
function parseRunArgument<Flags extends Parameters<typeof parseCommandLine>[1]['options']>(
	command: RunCommand,
	argv: string[],
	flags: Flags
) {
	const { values, positionals } = parseCommandLine(argv, { options: flags, strict: true, allowPositionals: true });
	const [run, ...extra] = positionals;

	if (extra.length > 0) throw usageError(`recoder ${command} takes one run id; got also "${extra.join(' ')}".`);

	return { run: parseRunReference(run), values };
}
