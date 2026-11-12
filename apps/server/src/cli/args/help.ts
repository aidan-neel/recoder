import { VERSION } from '../../version.js';
import { PROGRAM_FLAGS } from '../audience.js';
import { EXIT } from '../exit.js';
import { SKILL_AGENTS, SKILL_SCOPES } from '../skill/skills-folder.js';
import { textWidth, type Surface } from '../terminal/surface.js';
import { indent, padEnd, wrapText } from '../terminal/text.js';
import { helpRows, type FlagGroup, type FlagTable, type HelpRow } from './flag-table.js';
import {
	INIT_FLAGS,
	LIST_FLAGS,
	MODELS_FLAGS,
	NON_RANGE_TARGETS,
	REPORT_FLAGS,
	REVIEW_FLAGS,
	UPGRADE_FLAGS,
	WAIT_FLAGS
} from './flags.js';
import type { RunCommand } from './run-args.js';

const MARGIN = 2;

const COLUMN_GAP = 3;

/** The widest a first column may be. A longer name stands on a line of its own, with what it means under it. */
const MAX_NAME_WIDTH = 28;

const EXAMPLES_TITLE = 'Examples';

/** A titled block of rows: commands, flags or exit codes, each with what it means. */
interface HelpSection {
	title: string;
	rows: readonly HelpRow[];
}

/** One command's help: how it is called, what it does, its flags, and anything to know after them. */
interface CommandHelp {
	usage: string;
	about: string;
	sections?: readonly HelpSection[];
	notes?: readonly string[];
}

/** What `--help` can explain: the program, or one command. */
export type HelpTopic = 'main' | 'review' | 'init' | 'upgrade' | 'models' | 'doctor' | 'mcp' | 'skill' | RunCommand;

/** The title of each group of flags, in the order a command's help lists them. */
const GROUP_TITLES: Record<FlagGroup, string> = {
	target: 'What to review',
	scope: 'Scope',
	intent: 'Intent',
	tuning: 'Tuning',
	output: 'Output',
	running: 'Running',
	flags: 'Flags'
};

const RUN_ARGUMENT =
	'[run] is a run id or its last six characters, as recoder runs shows them. Left out, it is the newest run.';

const PROGRAM_FLAG_ROW: HelpRow = [
	PROGRAM_FLAGS.join(', '),
	'Print JSON for a program to read, not text for a person. Works with every command.'
];

const COMMAND_SECTIONS: readonly HelpSection[] = [
	{
		title: 'Review',
		rows: [
			['review', 'Review a change and print what it found'],
			['runs', 'List recent reviews'],
			['status [run]', 'Show how a review is doing'],
			['wait [run]', 'Watch a review until it ends'],
			['result [run]', "Print a finished review's report"],
			['cancel [run]', 'Stop a running review']
		]
	},
	{
		title: 'Set up',
		rows: [
			['init', 'Set Recoder up for your coding agents'],
			['doctor', 'Check that this machine can run a review'],
			['models', 'List the models a review can run on'],
			['upgrade', 'Replace this program with the latest release']
		]
	},
	{
		title: 'For agents',
		rows: [
			['skill', 'Print or install the agent skill'],
			['mcp', 'Serve the commands as MCP tools on standard input and output']
		]
	},
	{
		title: 'Flags',
		rows: [
			PROGRAM_FLAG_ROW,
			['--help', 'Explain a command, as in recoder review --help'],
			['--version', 'Print the version']
		]
	}
];

const EXIT_CODES: HelpSection = {
	title: 'Exit codes',
	rows: [
		[String(EXIT.ok), 'Done. No finding met --fail-on.'],
		[String(EXIT.findings), 'The review finished and a finding met --fail-on.'],
		[String(EXIT.usage), 'A flag or argument was wrong, or no run matched. Nothing ran.'],
		[String(EXIT.failed), 'The review did not finish, or its report is missing.'],
		[String(EXIT.notReady), 'This machine is not ready. Run recoder doctor.'],
		[String(EXIT.cancelled), 'Stopped by a signal or by --timeout.']
	]
};

const START_HERE: HelpSection = {
	title: 'Start here',
	rows: [
		['recoder init', 'Set up this project or this machine'],
		['recoder review --uncommitted', 'Review your work in progress'],
		['recoder review --pull 214', 'Review a pull request']
	]
};

const STATUS_FIELDS =
	'With -p a status is one JSON object: { schemaVersion, runId, state (running, complete, failed or cancelled), stage, startedAt, finishedAt, repoPath, targetKind, findings, unconfirmed, exitCode, error, reportFile, logFile }.';

const COMMAND_HELP: Record<Exclude<HelpTopic, 'main'>, CommandHelp> = {
	review: {
		usage: 'recoder review [flags]',
		about:
			'Reviews a change and prints what it found. Reviewers read the diff and the code around it, then verifiers try to reproduce each bug by running code in a sandbox. Your working tree is only read. Every review is recorded as a run; recoder runs lists them.',
		sections: [
			...flagSections(REVIEW_FLAGS),
			EXIT_CODES,
			{
				title: EXAMPLES_TITLE,
				rows: [
					['recoder review', 'The current branch against the default branch'],
					['recoder review --uncommitted', 'Everything not committed yet'],
					['recoder review --pull 214 --budget medium', 'A pull request, reviewed more deeply'],
					['recoder review --lens correctness,security', 'Two lenses only'],
					['recoder review --detach', 'In the background; recoder wait follows it']
				]
			}
		],
		notes: [
			`Choose at most one of ${listFlags(NON_RANGE_TARGETS)}. With none, the commits on the current branch since it left the default branch are reviewed.`
		]
	},
	init: {
		usage: 'recoder init [--project | --global] [flags]',
		about:
			'Sets Recoder up for your coding agents. It installs the agent skill, which teaches an agent when and how to run a review, saves the model reviews run on when none is chosen yet, and checks that this machine is ready. On a terminal it asks for what the flags leave open.',
		sections: flagSections(INIT_FLAGS),
		notes: [
			'--project writes into this folder, to commit with the repository: the skill under .claude/skills or .agents/skills, and a RECODER.md for the rules reviewers follow here.',
			'--global writes into your home folder, for every project: the skill under ~/.claude/skills or ~/.agents/skills.',
			'Run it again after an update to refresh the skill.'
		]
	},
	upgrade: {
		usage: 'recoder upgrade [--to <release>] [--check]',
		about:
			'Replaces this program with the latest release. It downloads the binary for this machine, checks it against the checksums of the release, runs it once, and only then puts it in place, so a failed download leaves the program as it was.',
		sections: flagSections(UPGRADE_FLAGS),
		notes: [
			'A newer release brings a newer agent skill. Run recoder init afterwards to refresh the installed one.',
			'With -p it prints one line of JSON: { state, currentVersion, targetVersion, path }. state is current when there is nothing to install, available when --check found a release, and upgraded when the binary at path was replaced.'
		]
	},
	status: {
		usage: 'recoder status [run]',
		about: "Shows a run's state, its counts once it has ended, and where its report and log are.",
		notes: [RUN_ARGUMENT, STATUS_FIELDS]
	},
	wait: {
		usage: 'recoder wait [run] [--timeout <minutes>]',
		about: `Follows a run until it ends or the timeout passes, then shows its status. On a terminal it shows the review's progress as it happens. Exit ${EXIT.ok} either way; with -p, read state.`,
		sections: flagSections(WAIT_FLAGS),
		notes: [RUN_ARGUMENT, `A signal stops the wait with exit ${EXIT.cancelled}; the run goes on.`, STATUS_FIELDS]
	},
	result: {
		usage: 'recoder result [run] [flags]',
		about: "Prints a finished run's report, as recoder review would have. A run with no report prints its error.",
		sections: [...flagSections(REPORT_FLAGS), EXIT_CODES],
		notes: [RUN_ARGUMENT, 'For a run that ended with no report, result exits with the code the run ended with.']
	},
	cancel: {
		usage: 'recoder cancel [run]',
		about: 'Asks a running review to stop and shows its status. A run that is not running is left as it is.',
		notes: [RUN_ARGUMENT, `${STATUS_FIELDS} cancel adds stopRequested.`]
	},
	runs: {
		usage: 'recoder runs [--repo <path>] [--limit <n>]',
		about: 'Lists recent runs, newest first. With -p, a JSON array of statuses.',
		sections: flagSections(LIST_FLAGS)
	},
	models: {
		usage: 'recoder models [--provider <name>] [--search <text>]',
		about:
			'Lists the models --reviewer, --worker and --verifier accept on this machine, grouped by provider, with the saved picks marked. OpenCode and Devin list their models by running, so each may take up to 10 seconds.',
		sections: flagSections(MODELS_FLAGS),
		notes: [
			'With -p it prints one line of JSON: { reviewer, worker, models: [{ id, name, provider, efforts, defaultEffort }], problems }. reviewer and worker are the saved picks, or null. An agent that cannot list its models adds a line to problems, and the other models are still listed.',
			`Exit ${EXIT.ok}, also for an empty list. ${EXIT.usage}: a flag was wrong, or a provider has no model here. ${EXIT.cancelled}: a signal stopped the listing.`
		]
	},
	doctor: {
		usage: 'recoder doctor',
		about: `Checks that a review can run here: git, the folders it writes to, the review model and its sign-in, and whether code can run in the sandbox. Each failed check names its fix. Exit ${EXIT.ok} when ready, ${EXIT.notReady} when not.`,
		notes: ['With -p it prints a JSON report: { ok, checks: [{ id, ok, required, detail, fix }] }.']
	},
	mcp: {
		usage: 'recoder mcp',
		about:
			'Serves doctor, models, review, wait, status, result, cancel and runs as MCP tools named recoder_<command>, on standard input and output. Set it up in an agent as an MCP server with the command recoder and the argument mcp, or let recoder init --mcp do it. A review it started goes on when the server ends; recoder_runs finds it again.'
	},
	skill: {
		usage: 'recoder skill <show|install> [flags]',
		about:
			'The agent skill teaches a coding agent to run reviews with recoder. recoder init installs it for you; these commands are the parts.',
		sections: [
			{
				title: 'Commands',
				rows: [
					['show', 'Print SKILL.md'],
					['install', 'Write the skill to <skills folder>/recoder']
				]
			},
			{
				title: 'Install flags',
				rows: [
					[`--agent <${SKILL_AGENTS.join('|')}>`, 'Whose skills folder to use. Default: claude.'],
					[
						`--scope <${SKILL_SCOPES.join('|')}>`,
						'user: ~/.claude/skills or ~/.agents/skills. project: the same under the working directory. Default: user.'
					],
					['--dir <path>', 'Use this skills folder instead; relative to the working directory. For any other agent.'],
					['--force', 'Replace an existing recoder folder. Nothing beside it is touched.']
				]
			}
		],
		notes: [
			'Install refuses an existing recoder folder without --force, and a recoder folder that is a symbolic link always. With -p it prints one JSON line: {"installed":"<path>","files":<n>}.'
		]
	}
};

/** The help for a topic, laid out and styled for the surface it is printed on. */
export function renderHelp(topic: HelpTopic, surface: Surface): string {
	const blocks = topic === 'main' ? mainHelp(surface) : commandHelp(COMMAND_HELP[topic], surface);
	const lines = blocks.join('\n\n').split('\n');

	return ['', ...indent(lines, MARGIN), ''].join('\n');
}

function mainHelp(surface: Surface): string[] {
	const { paint, glyphs } = surface;
	const title = `${paint.strong('recoder')} ${paint.muted(`${VERSION} ${glyphs.separator} code review that proves what it finds`)}`;

	return [
		title,
		usageBlock('recoder <command> [flags]', surface),
		...sectionBlocks(COMMAND_SECTIONS, surface),
		noteBlock(RUN_ARGUMENT, surface),
		...sectionBlocks([START_HERE], surface)
	];
}

function commandHelp(help: CommandHelp, surface: Surface): string[] {
	const flags: HelpSection[] = hasFlagSection(help) ? [] : [{ title: 'Flags', rows: [PROGRAM_FLAG_ROW] }];

	return [
		usageBlock(help.usage, surface),
		noteBlock(help.about, surface),
		...sectionBlocks([...(help.sections ?? []), ...flags].filter(isReference), surface),
		...(help.notes ?? []).map((note) => noteBlock(note, surface)),
		...sectionBlocks(
			(help.sections ?? []).filter((section) => !isReference(section)),
			surface
		)
	];
}

/** Examples close a command's help, in a column of their own: their first column is a whole command line. */
function isReference(section: HelpSection): boolean {
	return section.title !== EXAMPLES_TITLE;
}

/** A command whose sections already list flags gets `-p` added to the last of them by `flagSections`. */
function hasFlagSection(help: CommandHelp): boolean {
	return (help.sections ?? []).some((section) => section.rows.includes(PROGRAM_FLAG_ROW));
}

function usageBlock(usage: string, surface: Surface): string {
	return `${surface.paint.strong('Usage')}\n${' '.repeat(MARGIN)}${usage}`;
}

/** A paragraph wrapped to the surface. */
function noteBlock(text: string, surface: Surface): string {
	return wrapText(text, textWidth(surface, MARGIN * 2)).join('\n');
}

/** Sections with their first columns lined up as one, so the eye runs down a single edge. */
function sectionBlocks(sections: readonly HelpSection[], surface: Surface): string[] {
	const longest = Math.max(0, ...sections.flatMap(({ rows }) => rows.map(([name]) => name.length)));
	const width = Math.min(longest, MAX_NAME_WIDTH);

	return sections.map((section) => sectionBlock(section, width, surface));
}

function sectionBlock(section: HelpSection, width: number, surface: Surface): string {
	const rows = section.rows.flatMap((row) => rowLines(row, width, surface));

	return [surface.paint.strong(section.title), ...indent(rows, MARGIN)].join('\n');
}

/**
 * A name and what it means; a description that runs onto more lines lines up under its first. A name wider than the
 * column takes a line of its own.
 */
function rowLines([name, description]: HelpRow, width: number, surface: Surface): string[] {
	const room = textWidth(surface, MARGIN * 2 + width + COLUMN_GAP);
	const lines = description.split('\n').flatMap((line) => wrapText(line, room));
	const column = width + COLUMN_GAP;

	if (name.length > width) return [surface.paint.code(name), ...indent(lines, column)];

	const [first = '', ...rest] = lines;

	return [`${surface.paint.code(padEnd(name, width))}${' '.repeat(COLUMN_GAP)}${first}`, ...indent(rest, column)];
}

/** The help sections of a command's flags, in the order of `GROUP_TITLES`, with `-p` closing the last. */
function flagSections(table: FlagTable): HelpSection[] {
	const sections = Object.keys(GROUP_TITLES)
		.filter(isFlagGroup)
		.map((group) => ({ title: GROUP_TITLES[group], rows: helpRows(table, group) }))
		.filter(({ rows }) => rows.length > 0);

	const last = sections.pop();

	return last ? [...sections, { ...last, rows: [...last.rows, PROGRAM_FLAG_ROW] }] : [];
}

function isFlagGroup(key: string): key is FlagGroup {
	return key in GROUP_TITLES;
}

/** `--a, --b and --c`. */
function listFlags(names: readonly string[]): string {
	const flags = names.map((name) => `--${name}`);

	return `${flags.slice(0, -1).join(', ')} and ${flags[flags.length - 1]}`;
}
