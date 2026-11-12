/** "1 decision", "3 decisions". */
export function plural(count: number, word: string, many = `${word}s`): string {
	return `${count} ${count === 1 ? word : many}`;
}

/** A span of time in the largest whole unit: "40 seconds", "2 minutes", "3 hours". */
export function span(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));

	if (seconds < 60) return plural(seconds, 'second');

	const minutes = Math.round(seconds / 60);

	return minutes < 60 ? plural(minutes, 'minute') : plural(Math.round(minutes / 60), 'hour');
}

/** The repository's own name, without its owner: `api` for `acme/api`. */
export function repoName(repo: string): string {
	return repo.split('/').pop() ?? repo;
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
