/** The views of Settings → Server, in the page bar's order. */
export const SERVER_VIEWS = [
	{ value: 'overview', label: 'Overview' },
	{ value: 'updates', label: 'Updates' },
	{ value: 'backups', label: 'Backups' },
	{ value: 'logs', label: 'Logs' }
] as const;

export type ServerView = (typeof SERVER_VIEWS)[number]['value'];

/** The view an address names: the first when none is named, null for one Settings → Server does not have. */
export function serverViewOf(id: string | undefined): ServerView | null {
	return SERVER_VIEWS.find((view) => view.value === (id ?? SERVER_VIEWS[0].value))?.value ?? null;
}
