import { VERSION } from '../../version.js';
import { usageError } from '../exit.js';
import type { ModelsQuery } from '../models/model-list.js';
import { doctorHelp, mainHelp, mcpHelp, modelsHelp, reviewHelp, RUN_COMMAND_HELP } from './help.js';
import { parseModelsQuery } from './models-args.js';
import { parseFlags } from './parse.js';
import { parseReviewArgs, type ReviewRequest } from './review-args.js';
import { isRunCommand, parseRunInvocation, RUN_COMMANDS, type RunInvocation } from './run-args.js';

const COMMANDS = ['review', ...RUN_COMMANDS, 'models', 'skill', 'mcp', 'doctor'] as const;

/** The commands that take no flags, with the help each prints. */
const FLAGLESS_HELP = { doctor: doctorHelp, mcp: mcpHelp } as const;

/**
 * What the command line was asked to do. `print` is for help and version: write the text and exit 0. `skill` passes
 * its arguments on untouched; that command reads its own.
 */
export type Invocation =
	| { command: 'print'; text: string }
	| { command: keyof typeof FLAGLESS_HELP }
	| ({ command: 'review' } & ReviewRequest)
	| { command: 'models'; query: ModelsQuery }
	| { command: 'skill'; argv: string[] }
	| RunInvocation;

/** Reads the whole argv (without the program and script) into one invocation. Throws a `CliError` for a bad one. */
export function parseInvocation(argv: string[], workingDirectory: string): Invocation {
	const [command, ...flags] = argv;

	if (command === undefined || command === '--help' || command === 'help')
		return { command: 'print', text: mainHelp() };

	if (command === '--version') return { command: 'print', text: VERSION };

	if (command === 'review') return parseReview(flags, workingDirectory);

	if (command === 'doctor' || command === 'mcp') return parseFlagless(command, flags);

	if (command === 'models') return parseModels(flags);

	if (command === 'skill') return { command: 'skill', argv: flags };

	if (isRunCommand(command)) {
		if (flags.includes('--help')) return { command: 'print', text: RUN_COMMAND_HELP[command] };

		return parseRunInvocation(command, flags, workingDirectory);
	}

	throw usageError(`unknown command "${command}"; use ${COMMANDS.join(', ')}.`);
}

/** Where a usage error for this argv points the caller: the command's own help when the command is known. */
export function usageHint(argv: string[]): string {
	const command = COMMANDS.find((known) => known === argv[0]);

	return command === undefined ? 'Run `recoder --help` for the commands.' : `Run \`recoder ${command} --help\`.`;
}

/** `--help` anywhere in the flags wins, so it works even beside a flag that would not parse. */
function parseReview(flags: string[], workingDirectory: string): Invocation {
	if (flags.includes('--help')) return { command: 'print', text: reviewHelp() };

	return { command: 'review', ...parseReviewArgs(flags, workingDirectory) };
}

/** A command with no flags of its own: `--help` prints its help, and any other flag or argument is refused. */
function parseFlagless(command: keyof typeof FLAGLESS_HELP, flags: string[]): Invocation {
	if (flags.includes('--help')) return { command: 'print', text: FLAGLESS_HELP[command]() };

	parseFlags(flags, { options: {}, strict: true, allowPositionals: false });

	return { command };
}

function parseModels(flags: string[]): Invocation {
	if (flags.includes('--help')) return { command: 'print', text: modelsHelp() };

	return { command: 'models', query: parseModelsQuery(flags) };
}
