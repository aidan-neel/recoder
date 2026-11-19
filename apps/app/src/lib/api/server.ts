import type { ServerChecks } from '@recoder/shared';

import { post, request } from './http';

/** The server's own state, for the setup checklist and Settings → Server; the admin's once an account exists. */
export const serverApi = {
	checks: () => request<ServerChecks>('/api/server/checks'),
	/** Runs every check again, the model's one call included; answers at once with `running: true`. */
	runChecks: () => post<ServerChecks>('/api/server/checks')
};
