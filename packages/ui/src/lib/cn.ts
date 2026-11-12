import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * No class, or one class with no space in it. A single class has nothing to
 * conflict with, so merging would return it unchanged; about half the kit's
 * calls on a page are this, mostly a `className` the caller left out.
 */
const ONE_CLASS = /^\S*$/;

/** Joins class names; on a Tailwind conflict the later class wins, so a caller's class overrides the kit's. */
export function cn(...inputs: ClassValue[]): string {
	const classes = clsx(inputs);

	return ONE_CLASS.test(classes) ? classes : twMerge(classes);
}
