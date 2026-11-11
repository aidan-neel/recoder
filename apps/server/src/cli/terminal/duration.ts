const MS_PER_SECOND = 1000;

const SECONDS_PER_MINUTE = 60;

const MINUTES_PER_HOUR = 60;

const HOURS_PER_DAY = 24;

/** Past this many days a date says more than a count of days. */
const MAX_DAYS_AGO = 14;

const TWO_DIGITS = 2;

/** How long something took: `4s`, `1m 02s`, `1h 03m`. Whole seconds, so a live count does not flicker. */
export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
	const seconds = totalSeconds % SECONDS_PER_MINUTE;
	const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const minutes = totalMinutes % MINUTES_PER_HOUR;
	const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);

	if (hours > 0) return `${hours}h ${twoDigits(minutes)}m`;

	if (minutes > 0) return `${minutes}m ${twoDigits(seconds)}s`;

	return `${seconds}s`;
}

/** How long ago something happened: `just now`, `3m ago`, `2h ago`, `3d ago`, then the date. */
export function formatAgo(then: Date, now: Date): string {
	const seconds = Math.floor((now.getTime() - then.getTime()) / MS_PER_SECOND);
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
	const hours = Math.floor(minutes / MINUTES_PER_HOUR);
	const days = Math.floor(hours / HOURS_PER_DAY);

	if (seconds < SECONDS_PER_MINUTE) return 'just now';

	if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;

	if (hours < HOURS_PER_DAY) return `${hours}h ago`;

	if (days <= MAX_DAYS_AGO) return `${days}d ago`;

	return then.toISOString().slice(0, 'yyyy-mm-dd'.length);
}

function twoDigits(value: number): string {
	return String(value).padStart(TWO_DIGITS, '0');
}
