import { usageError } from '../exit.js';
import type { ReviewScope } from '../review/options.js';

/**
 * The scope as git pathspecs for after `--`. Every pattern gets explicit glob
 * magic, so a pattern can never smuggle in magic of its own (`:(top)`, `:!`)
 * or be read as an option.
 */
export function scopePathspecs(scope: ReviewScope): string[] {
	return [
		...scope.include.map((pattern) => `:(glob)${checkedPattern(pattern)}`),
		...scope.exclude.map((pattern) => `:(exclude,glob)${checkedPattern(pattern)}`)
	];
}

/** Whether the scope narrows the review at all. */
export function isScoped(scope: ReviewScope): boolean {
	return scope.include.length > 0 || scope.exclude.length > 0;
}

function checkedPattern(pattern: string): string {
	if (!pattern.trim()) throw usageError('A path pattern in --include or --exclude is empty.');

	return pattern;
}
