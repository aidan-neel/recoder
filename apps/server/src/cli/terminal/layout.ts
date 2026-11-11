import type { Surface } from './surface.js';
import { padEnd } from './text.js';

/** A command a person may want to run next, and what it is for. */
export type NextStep = readonly [command: string, purpose: string];

/** Label and value pairs as lines: the labels muted, the values in one column. */
export function factRows(rows: readonly (readonly [label: string, value: string])[], surface: Surface): string[] {
	const width = Math.max(0, ...rows.map(([label]) => label.length));

	return rows.map(([label, value]) => `${surface.paint.muted(padEnd(label, width))}  ${value}`);
}

/** Commands as lines, each followed by what it is for, muted and in one column. */
export function commandRows(steps: readonly NextStep[], surface: Surface): string[] {
	const width = Math.max(0, ...steps.map(([command]) => command.length));

	return steps.map(([command, purpose]) => `${padEnd(command, width)}   ${surface.paint.muted(purpose)}`);
}

/** A section's title with a rule running from it to the right edge of the text. */
export function sectionRule(title: string, width: number, surface: Surface): string {
	const rule = surface.glyphs.rule.repeat(Math.max(2, width - title.length - 1));

	return `${surface.paint.strong(title)} ${surface.paint.muted(rule)}`;
}
