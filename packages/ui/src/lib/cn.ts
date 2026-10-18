import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; on a Tailwind conflict the later class wins, so a caller's class overrides the kit's. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
