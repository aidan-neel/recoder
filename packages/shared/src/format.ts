/** Small display formats shared by apps/web and apps/app. */

/** Compact age for a row's meta line: 5m, 5h, 1d, 3w. Empty when the date is missing. */
export function shortAge(iso: string, now = Date.now()): string {
	const at = Date.parse(iso);

	if (Number.isNaN(at)) return '';

	const minutes = Math.max(0, (now - at) / 60_000);

	if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;

	const hours = minutes / 60;

	if (hours < 24) return `${Math.round(hours)}h`;

	const days = hours / 24;

	if (days < 14) return `${Math.round(days)}d`;

	return `${Math.round(days / 7)}w`;
}

/** Two letters for an avatar without a picture: "aidan-neel" → "AN"; one word gives its first two letters. */
export function initials(name: string): string {
	const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
	const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);

	return letters.toUpperCase();
}
