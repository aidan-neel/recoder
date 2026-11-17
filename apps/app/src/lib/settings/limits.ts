import type { ModelSettings } from '@recoder/shared';

import { formatCount } from '../shell/format';

type LimitKey = keyof ModelSettings['limits'];

export interface LimitFieldSpec {
	key: LimitKey;
	name: string;
	hint: string;
	max: number;
	step: number;
	shiftStep: number;
}

/** The review limits, with the server's caps and stepper increments. */
export const LIMIT_FIELDS: readonly LimitFieldSpec[] = [
	{
		key: 'maxFiles',
		name: 'Files per review',
		hint: 'Larger pull requests are reviewed in part',
		max: 200,
		step: 10,
		shiftStep: 50
	},
	{
		key: 'maxDiffChars',
		name: 'Diff characters',
		hint: 'Total diff sent to reviewers',
		max: 1_000_000,
		step: 50_000,
		shiftStep: 100_000
	},
	{
		key: 'maxFileChars',
		name: 'Characters per file',
		hint: 'Longer files are truncated',
		max: 200_000,
		step: 1_000,
		shiftStep: 10_000
	}
];

/** The non-negative whole number `text` writes (allowing commas, spaces and underscores), or null. */
export function parseWholeNumber(text: string): number | null {
	const digits = text.replace(/[\s,_]/g, '');

	if (!/^\d+$/.test(digits)) return null;

	const value = Number(digits);

	return Number.isSafeInteger(value) ? value : null;
}

/**
 * A typed limit as a whole number from `min` to `max`, or the reason it isn't one.
 * Thousands separators and spaces are fine ("60,000").
 */
export function parseLimit(text: string, max: number, min = 1): { value: number } | { error: string } {
	const value = parseWholeNumber(text);
	const range = `Enter a whole number from ${formatCount(min)} to ${formatCount(max)}.`;

	if (value === null || value < min || value > max) return { error: range };

	return { value };
}

/**
 * Steps `value` to the next or previous multiple of `step` inside `[min, max]`.
 * A value outside the range clamps back to the nearest bound first.
 */
export function stepLimit(value: number, direction: -1 | 1, step: number, max: number, min = 1): number {
	if (direction > 0) {
		if (value < min) return min;

		const next = Math.floor(value / step) * step + step;

		return Math.min(max, Math.max(min, next));
	}

	if (value > max) return max;

	const next = Math.ceil(value / step) * step - step;

	return Math.max(min, Math.min(max, next));
}
