import type { UpdateBranches, UpdateStatus } from '@recoder/shared';

import { post, request } from './http';

/** The update calls Settings → Admin makes. All of them are the admin's: a member gets 403 `admin-only`. */
export interface UpdateApi {
	/** What an update would do, and how the running one is going. */
	status: () => Promise<UpdateStatus>;
	/** Fetches again and reports what is waiting. */
	check: () => Promise<UpdateStatus>;
	/** Starts the update in the background; rejects with 409 when it cannot run (a dirty or diverged tree, a managed install, one already running). */
	apply: () => Promise<UpdateStatus>;
	/** Fetches, then lists the remote branches the server's checkout can switch to. */
	branches: () => Promise<UpdateBranches>;
	/** Starts moving the server's checkout to another remote branch, the way an update applies; 409 when it cannot. */
	switchBranch: (branch: string) => Promise<UpdateStatus>;
}

/** The review server's updater. */
export const updateApi: UpdateApi = {
	status: () => request<UpdateStatus>('/api/update'),
	check: () => post<UpdateStatus>('/api/update/check'),
	apply: () => post<UpdateStatus>('/api/update'),
	branches: () => request<UpdateBranches>('/api/update/branches'),
	switchBranch: (branch) => post<UpdateStatus>('/api/update/branch', { branch })
};
