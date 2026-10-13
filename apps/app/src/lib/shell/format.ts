/** "4m", "3h", "2d": how long ago, in the fewest characters that stay clear. */
export function ago(iso: string, now = Date.now()): string {
	const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));

	if (Number.isNaN(minutes)) return '';
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;

	return `${Math.round(minutes / (60 * 24))}d`;
}

/** A pull request author, with bots shown as agents under their plain name. */
export function author(login: string): { name: string; agent: boolean } {
	const agent = /\[bot\]$/.test(login);

	return { name: agent ? login.replace(/\[bot\]$/, '') : login, agent };
}

/** "1 decision", "3 decisions". */
export function plural(count: number, word: string, many = `${word}s`): string {
	return `${count} ${count === 1 ? word : many}`;
}
