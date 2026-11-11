import { parseArgs, type ParseArgsConfig } from 'node:util';
import { usageError } from '../exit.js';
import { nearestOf } from './nearest.js';

const UNKNOWN_OPTION = 'ERR_PARSE_ARGS_UNKNOWN_OPTION';

/** The flag an unknown-option error names, as `parseArgs` quotes it. */
const NAMED_FLAG = /'--([^'=]+)/;

/** The flags `parseArgs` read and the bare arguments left over. */
interface ParsedCommandLine<Config extends ParseArgsConfig> {
	values: ReturnType<typeof parseArgs<Config>>['values'];
	positionals: string[];
}

/** Reads argv with `parseArgs`, turning its errors (unknown flag, missing value, stray argument) into usage errors. */
export function parseFlags<Config extends ParseArgsConfig>(
	argv: string[],
	config: Config
): ReturnType<typeof parseArgs<Config>>['values'] {
	return parseCommandLine(argv, config).values;
}

/** Like `parseFlags`, and also returns the bare arguments, for a command that takes them. */
export function parseCommandLine<Config extends ParseArgsConfig>(
	argv: string[],
	config: Config
): ParsedCommandLine<Config> {
	try {
		const { values, positionals } = parseArgs({ ...config, args: argv });

		return { values, positionals };
	} catch (error) {
		if (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')) {
			throw usageError(describeParseError(error, String(error.code), config));
		}

		throw error;
	}
}

/** The parser's message in one line; for a flag the command does not have, the one that was probably meant. */
function describeParseError(error: Error, code: string, config: ParseArgsConfig): string {
	const message = error.message.replace(/\s*\n\s*/g, ' ');
	const unknown = code === UNKNOWN_OPTION ? NAMED_FLAG.exec(message)?.[1] : undefined;

	if (unknown === undefined) return message;

	const meant = nearestOf(unknown, Object.keys(config.options ?? {}));

	return meant === null ? `unknown flag --${unknown}.` : `unknown flag --${unknown}. Did you mean --${meant}?`;
}
