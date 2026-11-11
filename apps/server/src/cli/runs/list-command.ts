import { EXIT, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import { writeStderrLine } from '../output/streams.js';
import type { Terminal } from '../terminal/terminal.js';
import { listRuns } from './run-list.js';
import { describeRun, type RunStatus } from './run-status.js';
import { runsView } from './run-view.js';

/** Which runs to list: at most `limit`, and only those of `repoPath` when it is set. */
export interface RunsQuery {
	limit: number;
	/** An absolute path, compared with each run's `repoPath` as a review records it. */
	repoPath: string | null;
}

/** The runs a query found, newest first, and one message per run whose record could not be read. */
export interface RecentRuns {
	statuses: RunStatus[];
	warnings: string[];
}

/** `recoder runs`: the newest runs, newest first. A run whose record cannot be read is named on standard error. */
export async function runListCommand(query: RunsQuery, terminal: Terminal): Promise<ExitCode> {
	const { statuses, warnings } = await listRecentRuns(query);

	writeWarnings(warnings);
	await printResult(terminal, statuses, runsView(new Date()));

	return EXIT.ok;
}

/** The newest runs that match the query; the limit applies after the repository filter. */
export async function listRecentRuns(query: RunsQuery): Promise<RecentRuns> {
	const { runs, unreadable } = await listRuns();
	const matching = runs.filter((run) => query.repoPath === null || run.repoPath === query.repoPath);

	return {
		statuses: await Promise.all(matching.slice(0, query.limit).map(describeRun)),
		warnings: unreadable.map((problem) => problem.message)
	};
}

/** Names each run that could not be read on standard error, as the command does and the MCP tool does too. */
export function writeWarnings(warnings: readonly string[]): void {
	for (const warning of warnings) writeStderrLine(`recoder: ${warning}`);
}
