import type { ModelSettings } from '@recoder/shared';

export type LimitKey = keyof ModelSettings['limits'];

/** The review limits, with the server's caps. */
export const LIMIT_FIELDS: readonly { key: LimitKey; name: string; hint: string; max: number }[] = [
	{ key: 'maxFiles', name: 'Files per review', hint: 'Larger pull requests are reviewed in part', max: 200 },
	{ key: 'maxDiffChars', name: 'Diff characters', hint: 'Total diff sent to reviewers', max: 1_000_000 },
	{ key: 'maxFileChars', name: 'Characters per file', hint: 'Longer files are truncated', max: 200_000 }
];

/**
 * A typed limit as a whole number from `min` to `max`, or the reason it isn't one.
 * Thousands separators and spaces are fine ("60,000").
 */
export function parseLimit(text: string, max: number, min = 1): { value: number } | { error: string } {
	const digits = text.replace(/[\s,_]/g, '');
	const range = `Enter a whole number from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}.`;

	if (!/^\d+$/.test(digits)) return { error: range };

	const value = Number(digits);

	return value >= min && value <= max ? { value } : { error: range };
}
