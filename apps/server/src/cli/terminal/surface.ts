import { glyphsFor, type Glyphs } from './glyphs.js';
import { paintFor, type Paint } from './paint.js';

/** The width a view is laid out for when the stream does not say how wide it is. */
const DEFAULT_COLUMNS = 80;

/** Prose wider than this is hard to read, so text is wrapped here even on a wider terminal. */
const MAX_TEXT_COLUMNS = 96;

/** The locale variables that say which characters a terminal shows, in the order the C library reads them. */
const LOCALE_VARIABLES = ['LC_ALL', 'LC_CTYPE', 'LANG'] as const;

/** The part of a stream a surface is read from; `process.stdout` and `process.stderr` both fit. */
export interface TerminalStream {
	isTTY?: boolean;
	columns?: number;
}

/** One output stream as a view sees it: whether a person watches it, how wide it is, and how to style text for it. */
export interface Surface {
	/** True for a terminal, where a view may redraw in place and ask questions. */
	isInteractive: boolean;
	columns: number;
	paint: Paint;
	glyphs: Glyphs;
}

/** A surface with no color at the default width, for a report written to a file and for anything that is not a terminal. */
export const PLAIN_SURFACE: Surface = {
	isInteractive: false,
	columns: DEFAULT_COLUMNS,
	paint: paintFor(false),
	glyphs: glyphsFor(true)
};

/** The surface of a stream, read now: a terminal can be resized while a view is up. */
export function surfaceOf(stream: TerminalStream, env: NodeJS.ProcessEnv): Surface {
	const isInteractive = stream.isTTY === true;

	return {
		isInteractive,
		columns: stream.columns && stream.columns > 0 ? stream.columns : DEFAULT_COLUMNS,
		paint: paintFor(hasColor(isInteractive, env)),
		glyphs: glyphsFor(hasUnicode(env))
	};
}

/** The width prose is wrapped to on a surface, less `indent`. */
export function textWidth(surface: Surface, indent: number): number {
	return Math.max(1, Math.min(surface.columns, MAX_TEXT_COLUMNS) - indent);
}

/**
 * `NO_COLOR` (https://no-color.org) switches color off wherever the output goes and `FORCE_COLOR` switches it on;
 * with neither, a terminal that is not `dumb` gets color and a pipe or a file gets none.
 */
function hasColor(isInteractive: boolean, env: NodeJS.ProcessEnv): boolean {
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;

	if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') return env.FORCE_COLOR !== '0';

	return isInteractive && env.TERM !== 'dumb';
}

/** A locale that is set and is not UTF-8, the Linux console and a `dumb` terminal get ASCII symbols. */
function hasUnicode(env: NodeJS.ProcessEnv): boolean {
	if (env.TERM === 'linux' || env.TERM === 'dumb') return false;

	const locale = LOCALE_VARIABLES.map((name) => env[name]).find((value) => value !== undefined && value !== '');

	return locale === undefined || /utf-?8/i.test(locale);
}
