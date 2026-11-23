/** How the app names a failed call's error kind, as the server classifies it (`models/call-errors.ts`). */
const ERROR_KIND_LABELS: Record<string, string> = {
	'rate-limit': 'Rate limited',
	'usage-limit': 'Usage limit reached',
	capacity: 'Over capacity',
	timeout: 'Timed out',
	deadline: 'Out of time',
	provider: 'Provider error',
	request: 'Rejected request',
	error: 'Other error'
};

/** A kind the app does not know yet reads as the server wrote it. */
export function errorKindLabel(kind: string): string {
	return ERROR_KIND_LABELS[kind] ?? kind;
}

/** A group's failed calls by kind, most first, then by name. */
export function failureKinds(byKind: Record<string, number>): { kind: string; label: string; count: number }[] {
	return Object.entries(byKind)
		.filter(([, count]) => count > 0)
		.map(([kind, count]) => ({ kind, label: errorKindLabel(kind), count }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
