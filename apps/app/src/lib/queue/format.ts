/** "acme/api", "acme/api and acme/web", "a, b and c". */
export function joinNames(names: string[]): string {
	if (names.length < 2) return names.join('');

	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A time of day in the reader's locale, such as 10:42 or 10:42 AM. */
function clockTime(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** When a list loaded, for the note a stale list shows: the time today, else the day and time. */
export function listTime(at: number): string {
	const day = new Date(at);

	if (day.toDateString() === new Date().toDateString()) return clockTime(at);

	return day.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
