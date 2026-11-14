/** A pull request author, with bots shown as agents under their plain name. */
export function author(login: string): { name: string; agent: boolean } {
	const agent = /\[bot\]$/.test(login);

	return { name: agent ? login.replace(/\[bot\]$/, '') : login, agent };
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
