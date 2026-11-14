import type { UpdateStatus } from '@recoder/shared';

import { post, request } from './http';

/** The update calls Settings → Admin makes. All of them are the admin's: a member gets 403 `admin-only`. */
export interface UpdateApi {
	/** What an update would do, and how the running one is going. */
	status: () => Promise<UpdateStatus>;
	/** Fetches again and reports what is waiting. */
	check: () => Promise<UpdateStatus>;
	/** Starts the update in the background; rejects with 409 when it cannot run (a dirty or diverged tree, a managed install, one already running). */
	apply: () => Promise<UpdateStatus>;
}

/** The review server's updater. */
export const updateApi: UpdateApi = {
	status: () => request<UpdateStatus>('/api/update'),
	check: () => post<UpdateStatus>('/api/update/check'),
	apply: () => post<UpdateStatus>('/api/update')
};
