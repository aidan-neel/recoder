import type { ParseArgsOptionDescriptor } from 'node:util';
import { z } from 'zod';
import { helpRowOf, type FlagTable } from '../args/flag-table.js';

type FlagValue = string | boolean | string[];

/** Tool input properties that stand for command-line flags, each optional and named as its flag. */
type FlagProperties = Record<string, z.ZodOptional<z.ZodType<FlagValue>>>;

/** Tool arguments that stand for command-line flags, by flag name. */
export type FlagArguments = Partial<Record<string, FlagValue>>;

/**
 * One tool property per flag of a command's table but those `leftOut`, typed by the flag's `parseArgs` kind and
 * described by its help row. A flag added to the table reaches the tool with no other change.
 */
export function flagProperties(table: FlagTable, leftOut: readonly string[]): FlagProperties {
	const kept = Object.entries(table).filter(([name]) => !leftOut.includes(name));

	return Object.fromEntries(
		kept.map(([name, flag]) => [name, valueSchema(flag).optional().describe(describeFlag(table, name))])
	);
}

/** A flag's help row on one line, as `--flag <value>: description`, for a tool property that stands for it. */
export function describeFlag(table: FlagTable, name: string): string {
	const [usage, description] = helpRowOf(table, name);

	return `${usage}: ${description.replaceAll('\n', ' ')}`;
}

/**
 * The flags that tool arguments stand for, as the command line takes them: a true boolean as the bare flag, a false
 * one left out, and each value after `=`, so a value that starts with a dash stays a value.
 */
export function flagArgv(values: FlagArguments): string[] {
	return Object.entries(values).flatMap(([name, value]) => flagWords(name, value));
}

/** A repeatable flag takes a list; the command line also splits each item on commas where the flag allows it. */
function valueSchema(option: ParseArgsOptionDescriptor): z.ZodType<FlagValue> {
	if (option.type === 'boolean') return z.boolean();

	if (option.multiple === true) return z.array(z.string()).min(1);

	return z.string();
}

function flagWords(name: string, value: FlagValue | undefined): string[] {
	if (value === undefined || value === false) return [];

	if (value === true) return [`--${name}`];

	if (typeof value === 'string') return [`--${name}=${value}`];

	return value.map((item) => `--${name}=${item}`);
}
