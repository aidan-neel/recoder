import { LENSES } from '../../review/pipeline/lenses/lenses.js';
import type { LensId } from '../../review/pipeline/lenses/types.js';
import { usageError } from '../exit.js';
import { REVIEW_LEVERS, type ReviewLever } from '../review/options.js';
import { parseChoice } from './values.js';

export const LENS_IDS: readonly LensId[] = LENSES.map((lens) => lens.id);

export const LEVER_IDS: readonly ReviewLever[] = Object.keys(REVIEW_LEVERS).filter(isReviewLever);

/** Fails when more than one of these flags is given, naming the ones that were. */
export function rejectMoreThanOne(values: Record<string, unknown>, names: readonly string[]): void {
	const given = names.filter((name) => values[name] !== undefined).map((name) => `--${name}`);

	if (given.length < 2) return;

	throw usageError(`Use only one of ${names.map((name) => `--${name}`).join(', ')}; got ${given.join(' and ')}.`);
}

/** `--lens`: the lenses to run, or null for all of them. */
export function parseLenses(values: { lens?: string[]; 'skip-lens'?: string[] }): LensId[] | null {
	rejectMoreThanOne(values, ['lens', 'skip-lens']);

	const only = parseList('--lens', values.lens, LENS_IDS);
	const skipped = parseList('--skip-lens', values['skip-lens'], LENS_IDS);

	if (skipped === null) return only;

	const kept = LENS_IDS.filter((id) => !skipped.includes(id));

	if (kept.length === 0) throw usageError('--skip-lens removes every lens; leave at least one.');

	return kept;
}

/** `--enable`: the optional stages to switch on. */
export function parseLevers(values: string[] | undefined): ReviewLever[] {
	return parseList('--enable', values, LEVER_IDS) ?? [];
}

/** A repeatable, comma-separated flag as its distinct choices in the order given; null when the flag is absent. */
function parseList<Choice extends string>(
	flag: string,
	values: string[] | undefined,
	choices: readonly Choice[]
): Choice[] | null {
	if (values === undefined) return null;

	const parsed = splitList(values).map((item) => parseChoice(flag, item, choices));

	if (parsed.length === 0) throw usageError(`${flag} needs at least one value from ${choices.join(', ')}.`);

	return parsed;
}

/** The distinct, non-empty items of a repeatable, comma-separated flag, in the order given. */
export function splitList(values: readonly string[]): string[] {
	const items = values.flatMap((value) => value.split(',')).map((item) => item.trim());

	return [...new Set(items.filter((item) => item !== ''))];
}

function isReviewLever(key: string): key is ReviewLever {
	return key in REVIEW_LEVERS;
}
