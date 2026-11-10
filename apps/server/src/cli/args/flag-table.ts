import type { ParseArgsOptionDescriptor } from 'node:util';

/** The range a whole-number flag accepts; no `max` means any size. */
export interface WholeNumberBounds {
	min: number;
	max?: number;
}

/** The part of a command's help that lists a flag. */
export type FlagGroup = 'target' | 'scope' | 'intent' | 'tuning' | 'output' | 'running' | 'flags';

/** What a flag is called in its usage when it takes a value: a placeholder such as `path`, or its closed list. */
type ValueName = { value: string; choices?: readonly string[] } | { value?: undefined; choices: readonly string[] };

/**
 * A flag of one command, as the one place that defines it. The entry is a `parseArgs` option, so a command's table is
 * its parse config as it stands, and the same entry gives the help row: `usage` comes from the type and the value name,
 * and the description may use the same constants the parser checks against. A flag with no description, or a value
 * with no name, does not type-check.
 */
type FlagDefinition = ParseArgsOptionDescriptor & {
	group: FlagGroup;
	description: string;
	/** For a whole-number flag: what the parser accepts, and what the description says it accepts. */
	bounds?: WholeNumberBounds;
} & ({ type: 'boolean' } | ({ type: 'string' } & ValueName));

/** One command's flags, by the name `parseArgs` reads them under. */
export type FlagTable = Readonly<Record<string, FlagDefinition>>;

/** One row of a command's help: how the flag is written, and what it does. */
export type HelpRow = readonly [usage: string, description: string];

/** `--budget <low|medium|high>`, `--repo <path>` or `--staged`. */
function usageOf(name: string, flag: FlagDefinition): string {
	if (flag.type === 'boolean') return `--${name}`;

	return `--${name} <${flag.value ?? flag.choices.join('|')}>`;
}

/** The help rows of the flags of a table that belong to `group`, in the table's order. */
export function helpRows(table: FlagTable, group: FlagGroup): HelpRow[] {
	return Object.entries(table)
		.filter(([, flag]) => flag.group === group)
		.map(([name, flag]) => [usageOf(name, flag), flag.description]);
}

/** The help row of one flag of a table; a name the table does not hold is a bug. */
export function helpRowOf(table: FlagTable, name: string): HelpRow {
	const flag = table[name];

	if (flag === undefined) throw new Error(`no flag --${name} in this command`);

	return [usageOf(name, flag), flag.description];
}
