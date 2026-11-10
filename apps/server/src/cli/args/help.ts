import { EXIT } from '../exit.js';
import { helpRows, type FlagGroup, type FlagTable, type HelpRow } from './flag-table.js';
import { LIST_FLAGS, MODELS_FLAGS, NON_RANGE_TARGETS, REPORT_FLAGS, REVIEW_FLAGS, WAIT_FLAGS } from './flags.js';

interface HelpGroup {
	title: string;
	rows: readonly HelpRow[];
}

/** The title of each group of flags, in the order a command's help lists them. */
const GROUP_TITLES: Record<FlagGroup, string> = {
	target: `Target (choose at most one of ${listFlags(NON_RANGE_TARGETS)}; none reviews a commit range)`,
	scope: 'Scope',
	intent: 'Intent',
	tuning: 'Tuning',
	output: 'Output',
	running: 'Running',
	flags: 'Flags'
};

const COMMANDS = `Commands:
  recoder review [flags]     Run one review and print the report. --detach runs it in the background.
  recoder status <run-id>    Print a run's status as JSON.
  recoder wait <run-id>      Wait for a run to end, then print its status.
  recoder result <run-id>    Print a finished run's report.
  recoder cancel <run-id>    Ask a running review to stop.
  recoder runs               List recent runs as JSON, newest first.
  recoder models             List the model ids --reviewer and --worker accept, as JSON.
  recoder skill              Print or install the agent skill.
  recoder mcp                Serve the commands as MCP tools on standard input and output.
  recoder doctor             Check this machine and print a JSON report. Exit ${EXIT.ok} when ready, ${EXIT.notReady} when not.
  recoder --version          Print the version.
  recoder <command> --help`;

const STATUS_FIELDS = `A status is one JSON object: { schemaVersion, runId, state (running, complete, failed or cancelled), stage, startedAt, finishedAt, repoPath, targetKind, findings, unconfirmed, exitCode, error, reportFile, logFile }.`;

const EXIT_CODES = `Exit codes:
  ${EXIT.ok}    Done. review and result: no written finding met --fail-on.
  ${EXIT.findings}    review and result: a written finding met --fail-on.
  ${EXIT.usage}    Any command: a flag or argument was wrong, or no run has that id. Nothing ran.
       result: the run is still running.
  ${EXIT.failed}    review: it started and did not finish; with --detach, the background review did not start.
       result: the run failed or its report is missing. Any command: an unexpected error.
  ${EXIT.notReady}    review, doctor and skill: this machine is not ready. Commands that read a run: ps is missing.
       Run recoder doctor.
  ${EXIT.cancelled}  review, wait, models and mcp: stopped by a signal; review also by --timeout. result: the run was cancelled.
  For a run that ended with no report, result exits with the code the run ended with.`;

const EXAMPLES = `Examples:
  Review the current branch against the default branch:
    recoder review

  Review uncommitted work, with a title, and write JSON to a file:
    recoder review --uncommitted --title "Add retry to the sync job" --format json --output review.json

  A deeper review of two lenses:
    recoder review --budget medium --lens correctness,security`;

/** The text of `recoder --help`. */
export function mainHelp(): string {
	return ['Usage: recoder <command> [flags]', COMMANDS, EXIT_CODES].join('\n\n');
}

/** The text of `recoder review --help`: every flag with its values and default, the exit codes and examples. */
export function reviewHelp(): string {
	return [
		'Usage: recoder review [flags]',
		'Reviews a change and prints a report on standard output. Progress goes to standard error. Every review is recorded as a run; recoder runs lists them.',
		formatGroups(groupsOf(REVIEW_FLAGS)),
		EXIT_CODES,
		EXAMPLES
	].join('\n\n');
}

/** The help of each command that reads or stops a recorded run. */
export const RUN_COMMAND_HELP = {
	status: ['Usage: recoder status <run-id>', `Prints the run's status. ${STATUS_FIELDS}`].join('\n\n'),
	wait: [
		'Usage: recoder wait <run-id> [--timeout <minutes>]',
		`Waits until the run ends or the timeout passes, then prints its status. Exit ${EXIT.ok} either way: read state. ${STATUS_FIELDS}`,
		formatGroups(groupsOf(WAIT_FLAGS)),
		`A signal stops the wait with exit ${EXIT.cancelled}; the run goes on.`
	].join('\n\n'),
	result: [
		'Usage: recoder result <run-id> [flags]',
		"Prints a finished run's report, as recoder review would have. A run with no report prints its error.",
		formatGroups(groupsOf(REPORT_FLAGS)),
		EXIT_CODES
	].join('\n\n'),
	cancel: [
		'Usage: recoder cancel <run-id>',
		`Asks a running review to stop and prints its status with stopRequested. A run that is not running is left as it is. ${STATUS_FIELDS}`
	].join('\n\n'),
	runs: [
		'Usage: recoder runs [--repo <path>] [--limit <n>]',
		'Prints recent runs as a JSON array of statuses, newest first.',
		formatGroups(groupsOf(LIST_FLAGS))
	].join('\n\n')
};

/** The text of `recoder models --help`. */
export function modelsHelp(): string {
	return [
		'Usage: recoder models [--provider <name>] [--search <text>]',
		'Prints the model ids that --reviewer and --worker accept on this machine, as one line of JSON: { reviewer, worker, models: [{ id, name, provider, efforts, defaultEffort }], problems }. reviewer and worker are the saved picks, or null. A model with no effort levels has efforts [] and defaultEffort null. OpenCode and Devin list their models by running, so each may take up to 10 seconds; one that cannot list adds a line to problems, and the other models are still listed. The list can be empty. recoder doctor checks that this machine is ready.',
		formatGroups(groupsOf(MODELS_FLAGS)),
		`Exit ${EXIT.ok}, also for an empty list. ${EXIT.usage}: a flag was wrong, or a provider has no model here. ${EXIT.cancelled}: a signal stopped the listing.`
	].join('\n\n');
}

/** The text of `recoder doctor --help`. */
export function doctorHelp(): string {
	return [
		'Usage: recoder doctor',
		`Checks that a review can run here and prints a JSON report: { ok, checks: [{ id, ok, required, detail, fix }] }. Exit ${EXIT.ok} when ready, ${EXIT.notReady} when not. Each failed check names its fix.`
	].join('\n\n');
}

/** The text of `recoder mcp --help`. */
export function mcpHelp(): string {
	return [
		'Usage: recoder mcp',
		'Serves doctor, models, review, wait, status, result, cancel and runs as MCP tools named recoder_<command>, on standard input and output. Set it up in an agent as an MCP server with the command recoder and the argument mcp. A review it started goes on when the server ends; recoder_runs finds it again.'
	].join('\n\n');
}

/** The help groups of a command's flags that has at least one flag, in the order of `GROUP_TITLES`. */
function groupsOf(table: FlagTable): HelpGroup[] {
	return Object.keys(GROUP_TITLES)
		.filter(isFlagGroup)
		.map((group) => ({ title: GROUP_TITLES[group], rows: helpRows(table, group) }))
		.filter(({ rows }) => rows.length > 0);
}

function isFlagGroup(key: string): key is FlagGroup {
	return key in GROUP_TITLES;
}

/** `--a, --b and --c`. */
function listFlags(names: readonly string[]): string {
	const flags = names.map((name) => `--${name}`);

	return `${flags.slice(0, -1).join(', ')} and ${flags[flags.length - 1]}`;
}

/** Groups of flags, their descriptions lined up in one column. */
function formatGroups(groups: readonly HelpGroup[]): string {
	const width = Math.max(...groups.flatMap(({ rows }) => rows.map(([flag]) => flag.length)));

	return groups.map(({ title, rows }) => formatGroup(title, rows, width)).join('\n\n');
}

function formatGroup(title: string, rows: readonly HelpRow[], width: number): string {
	const lines = rows.map(([flag, description]) => formatRow(flag, description, width));

	return [`${title}:`, ...lines].join('\n');
}

/** A flag and its description; a description that runs onto more lines lines up under the first. */
function formatRow(flag: string, description: string, width: number): string {
	const [first, ...rest] = description.split('\n');
	const indent = ' '.repeat(width + 4);

	return [`  ${flag.padEnd(width)}  ${first}`, ...rest.map((line) => `${indent}${line}`)].join('\n');
}
