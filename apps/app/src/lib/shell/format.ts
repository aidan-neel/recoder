/** A pull request author, with bots shown as agents under their plain name. */
export function author(login: string): { name: string; agent: boolean } {
	const agent = /\[bot\]$/.test(login);

	return { name: agent ? login.replace(/\[bot\]$/, '') : login, agent };
}

/** Formats counts for every call: building a formatter per number cost about a millisecond a page. */
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/** A count with thousands separators: `2,418`. */
export function formatCount(value: number): string {
	return COUNT_FORMAT.format(value);
}

const SHORT_COUNT_FORMAT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** A count shortened as GitHub shortens its counters: `999`, `1.2k`, `12.3k`, `1.5m`. */
export function shortCount(value: number): string {
	return SHORT_COUNT_FORMAT.format(value).toLowerCase();
}

/** The units a size steps through, a thousand apart, as disks are sold. */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size as a person reads it: `2 MB`, `1.1 GB`, `41 GB`. */
export function formatBytes(bytes: number): string {
	let value = bytes;
	let unit = 0;

	while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
		value /= 1000;
		unit += 1;
	}

	return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** "1 decision", "3 decisions". */
export function plural(count: number, word: string, many = `${word}s`): string {
	return `${count} ${count === 1 ? word : many}`;
}

/** A span of time in the largest whole unit: "40 seconds", "2 minutes", "3 hours", "4 days". */
export function span(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));

	if (seconds < 60) return plural(seconds, 'second');

	const minutes = Math.round(seconds / 60);

	if (minutes < 60) return plural(minutes, 'minute');

	const hours = Math.round(minutes / 60);

	return hours < 24 ? plural(hours, 'hour') : plural(Math.round(hours / 24), 'day');
}

/** The repository's own name, without its owner: `api` for `acme/api`. */
export function repoName(repo: string): string {
	return repo.split('/').pop() ?? repo;
}

/** How a pull request goes by in a short row: `api #214`. */
export function pullRef(repo: string, number: number): string {
	return `${repoName(repo)} #${number}`;
}

/** "acme/api", "acme/api and acme/web", "a, b and c". */
export function joinNames(names: string[]): string {
	if (names.length < 2) return names.join('');

	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A pull request's title, or `Pull request #214` when it has none. */
export function pullTitle(title: string | null | undefined, number: number): string {
	return title || `Pull request #${number}`;
}

/** "<1s", "41s", "2m 48s", "1h 4m": a length of time, to the second under an hour. */
export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);

	if (seconds < 1) return '<1s';
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);

	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
