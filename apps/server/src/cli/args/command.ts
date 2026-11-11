import type { Audience } from '../audience.js';
import { usageError } from '../exit.js';
import type { InitRequest } from '../init/init-request.js';
import type { ModelsQuery } from '../models/model-list.js';
import type { HelpTopic } from './help.js';
import { parseInitArgs } from './init-args.js';
import { parseModelsQuery } from './models-args.js';
import { nearestOf } from './nearest.js';
import { parseFlags } from './parse.js';
import { parseReviewArgs, type ReviewRequest } from './review-args.js';
import { isRunCommand, parseRunInvocation, RUN_COMMANDS, type RunInvocation } from './run-args.js';

const COMMANDS = ['review', ...RUN_COMMANDS, 'init', 'models', 'skill', 'mcp', 'doctor'] as const;

type Command = (typeof COMMANDS)[number];

const HELP_FLAGS = ['--help', '-h'];

/** The commands that take no flags of their own. */
type FlaglessCommand = 'doctor' | 'mcp';

/** Where a command line is read: the folder relative paths start from, and who reads the output. */
export interface InvocationContext {
	workingDirectory: string;
	audience: Audience;
}

/** What the command line was asked to do. `skill` passes its subcommand and flags on; that command reads its own. */
export type Invocation =
	| { command: 'help'; topic: HelpTopic }
	| { command: 'version' }
	| { command: FlaglessCommand }
	| ({ command: 'review' } & ReviewRequest)
	| { command: 'init'; request: InitRequest }
	| { command: 'models'; query: ModelsQuery }
	| { command: 'skill'; argv: string[] }
	| RunInvocation;

/**
 * Reads the argv (without the program, the script and the audience flags) into one invocation. Throws a `CliError`
 * for a bad one. `--help` anywhere among a command's flags wins, so it works even beside a flag that would not parse.
 */
export function parseInvocation(argv: string[], context: InvocationContext): Invocation {
	const [command, ...flags] = argv;

	if (command === undefined || command === 'help' || HELP_FLAGS.includes(command)) {
		return { command: 'help', topic: helpTopicOf(flags[0]) };
	}

	if (command === '--version' || command === '-v') return { command: 'version' };

	if (!isCommand(command)) throw unknownCommand(command);

	if (flags.some((flag) => HELP_FLAGS.includes(flag))) return { command: 'help', topic: command };

	return parseCommand(command, flags, context);
}

/** Where a usage error for this argv points the caller: the command's own help when the command is known. */
export function usageHint(argv: string[]): string {
	const command = COMMANDS.find((known) => known === argv[0]);

	return command === undefined ? 'Run `recoder --help` for the commands.' : `Run \`recoder ${command} --help\`.`;
}

function parseCommand(command: Command, flags: string[], context: InvocationContext): Invocation {
	if (isRunCommand(command)) return parseRunInvocation(command, flags, context);

	switch (command) {
		case 'review':
			return { command, ...parseReviewArgs(flags, context.workingDirectory, context.audience) };
		case 'init':
			return { command, request: parseInitArgs(flags) };
		case 'models':
			return { command, query: parseModelsQuery(flags) };
		case 'skill':
			return flags.length === 0 ? { command: 'help', topic: command } : { command, argv: flags };
		case 'doctor':
		case 'mcp':
			return parseFlagless(command, flags);
	}
}

/** `recoder help review` explains a command; anything else after `help` is the program's own help. */
function helpTopicOf(name: string | undefined): HelpTopic {
	return name !== undefined && isCommand(name) ? name : 'main';
}

function isCommand(name: string): name is Command {
	return COMMANDS.some((known) => known === name);
}

/** A command with no flags of its own: any flag or argument is refused. */
function parseFlagless(command: FlaglessCommand, flags: string[]): Invocation {
	parseFlags(flags, { options: {}, strict: true, allowPositionals: false });

	return { command };
}

function unknownCommand(command: string): Error {
	const meant = nearestOf(command, COMMANDS);
	const hint = meant === null ? `use ${COMMANDS.join(', ')}.` : `did you mean recoder ${meant}?`;

	return usageError(`unknown command "${command}"; ${hint}`);
}
