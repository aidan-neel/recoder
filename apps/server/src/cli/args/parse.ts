import { parseArgs, type ParseArgsConfig } from 'node:util';
import { usageError } from '../exit.js';

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
			throw usageError(error.message.replace(/\s*\n\s*/g, ' '));
		}

		throw error;
	}
}
