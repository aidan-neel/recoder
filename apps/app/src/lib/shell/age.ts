import { plural } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/** The time between `at` and `now` in ms, never negative; null when `at` is no date. */
function elapsed(at: string | null | undefined, now: number): number | null {
	const then = at ? Date.parse(at) : Number.NaN;

	return Number.isNaN(then) ? null : Math.max(0, now - then);
}

/** How long ago, in the fewest characters a list row can spend: `now`, `12m`, `5h`, `3d`, `6w`, `2y`. Empty when `at` is no date. */
export function shortAge(at: string | null | undefined, now: number): string {
	const ms = elapsed(at, now);

	if (ms === null) return '';
	if (ms < MINUTE) return 'now';
	if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
	if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
	if (ms < WEEK) return `${Math.floor(ms / DAY)}d`;
	if (ms < YEAR) return `${Math.floor(ms / WEEK)}w`;

	return `${Math.floor(ms / YEAR)}y`;
}

/** How long ago, as a phrase: `just now`, `12 minutes ago`, `5 hours ago`, `3 days ago`. Empty when `at` is no date. */
export function longAge(at: string | null | undefined, now: number): string {
	const ms = elapsed(at, now);

	if (ms === null) return '';
	if (ms < MINUTE) return 'just now';
	if (ms < HOUR) return `${plural(Math.floor(ms / MINUTE), 'minute')} ago`;
	if (ms < DAY) return `${plural(Math.floor(ms / HOUR), 'hour')} ago`;

	return `${plural(Math.floor(ms / DAY), 'day')} ago`;
}

/** The full date and time for a tooltip, in the reader's locale. Empty when `at` is no date. */
export function fullTime(at: string | null | undefined): string {
	const then = at ? Date.parse(at) : Number.NaN;

	return Number.isNaN(then) ? '' : new Date(then).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** A running clock for a review in progress: `2:14`, `1:02:09`. */
export function runClock(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const pad = (value: number) => String(value).padStart(2, '0');
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}
