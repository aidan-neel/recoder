import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SubagentCap } from '@recoder/shared';
import { describeError, usageError } from '../exit.js';
import type { WholeNumberBounds } from './flag-table.js';

const MS_PER_MINUTE = 60_000;

/** The longest delay Bun's `AbortSignal.timeout` accepts, 2^53 - 1 ms; a longer one, or Infinity, throws. */
const MAX_TIMEOUT_MS = Number.MAX_SAFE_INTEGER;

const MAX_TIMEOUT_MINUTES = Math.floor(MAX_TIMEOUT_MS / MS_PER_MINUTE);

const WHOLE_NUMBER = /^\d+$/;

const DECIMAL_NUMBER = /^\d+(?:\.\d+)?$/;

/** Allowed values as a phrase for an error: `a, b or c`. */
function listChoices(choices: readonly string[]): string {
	if (choices.length < 2) return choices.join('');

	return `${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}`;
}

/** The value if it is one of the choices; otherwise a usage error naming the flag, the value and the choices. */
export function parseChoice<Choice extends string>(flag: string, value: string, choices: readonly Choice[]): Choice {
	const choice = choices.find((candidate) => candidate === value);

	if (choice === undefined) throw usageError(`${flag} must be ${listChoices(choices)}; got "${value}".`);

	return choice;
}

/** A choice that may be left out: `fallback` when it is. */
export function parseChoiceOr<Choice extends string, Fallback extends Choice | null>(
	flag: string,
	value: string | undefined,
	choices: readonly Choice[],
	fallback: Fallback
): Choice | Fallback {
	return value === undefined ? fallback : parseChoice(flag, value, choices);
}

/** Text that names something, so a blank value is an error rather than a silent default. */
export function requireText(flag: string, value: string): string {
	if (value.trim() === '') throw usageError(`${flag} needs a value; got an empty string.`);

	return value;
}

/** Text that may be left out; null when it is. */
export function parseText(flag: string, value: string | undefined): string | null {
	return value === undefined ? null : requireText(flag, value);
}

/** Free text the review reads: trimmed, and null when it is missing or only white space, so no empty text reaches the review. */
export function normalizeText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();

	return trimmed === undefined || trimmed === '' ? null : trimmed;
}

/** A whole number from `min` up to `max`, or up to anything when there is no `max`. */
export function parseWholeNumber(flag: string, value: string, range: WholeNumberBounds): number {
	const { min, max } = range;
	const number = WHOLE_NUMBER.test(value) ? Number(value) : NaN;

	if (Number.isSafeInteger(number) && number >= min && (max === undefined || number <= max)) return number;

	const bound = max === undefined ? `at least ${min}` : `from ${min} to ${max}`;

	throw usageError(`${flag} must be a whole number ${bound}; got "${value}".`);
}

/** `--subagents`: a count, or `uncapped`. */
export function parseSubagents(value: string | undefined, bounds: WholeNumberBounds): SubagentCap | number | null {
	if (value === undefined) return null;

	if (value === 'uncapped') return value;

	return parseWholeNumber('--subagents', value, bounds);
}

/** `--timeout`: minutes, possibly fractional, as milliseconds the runtime can wait for. */
export function parseTimeoutMs(value: string | undefined): number | null {
	if (value === undefined) return null;

	const minutes = DECIMAL_NUMBER.test(value) ? Number(value) : 0;
	const milliseconds = Math.max(1, Math.round(minutes * MS_PER_MINUTE));

	if (minutes > 0 && milliseconds <= MAX_TIMEOUT_MS) return milliseconds;

	throw usageError(`--timeout must be a number of minutes above 0 and at most ${MAX_TIMEOUT_MINUTES}; got "${value}".`);
}

/** The text of a file named by a flag; an unreadable file is a usage error that names the path. */
export function readTextFile(flag: string, path: string, workingDirectory: string): string {
	const absolute = resolve(workingDirectory, requireText(flag, path));

	try {
		return readFileSync(absolute, 'utf8');
	} catch (error) {
		throw usageError(`${flag} cannot read ${absolute}: ${describeError(error)}`);
	}
}
