/**
 * Who reads what a command prints. A `person` gets text laid out for a terminal; a `program`, such as a coding agent
 * or a script, gets JSON with fields that do not change shape.
 */
export type Audience = 'person' | 'program';

/** The flags that say a program reads the output. They may stand anywhere before a `--`. */
export const PROGRAM_FLAGS = ['-p', '--programmatic'] as const;

const END_OF_FLAGS = '--';

/** A command line with the audience flags taken out, and the audience they chose. */
interface AudienceSplit {
	audience: Audience;
	argv: string[];
}

/**
 * Takes `-p` and `--programmatic` out of argv. No flag takes a value that starts with a dash unless it is written
 * `--flag=value`, so an argument equal to one of them is always the flag.
 */
export function splitAudience(argv: readonly string[]): AudienceSplit {
	const end = argv.indexOf(END_OF_FLAGS);
	const flags = end === -1 ? argv : argv.slice(0, end);
	const rest = end === -1 ? [] : argv.slice(end);
	const kept = flags.filter((argument) => !isProgramFlag(argument));

	return { audience: kept.length === flags.length ? 'person' : 'program', argv: [...kept, ...rest] };
}

function isProgramFlag(argument: string): boolean {
	return PROGRAM_FLAGS.some((flag) => flag === argument);
}
