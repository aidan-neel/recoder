import type { LogPage, UpdateBranches, UpdateHistoryEntry, UpdatePolicy, UpdateStatus } from '@recoder/shared';

import { post, put, request, seg } from './http';

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
	/** Goes back to an earlier version, the way an update applies; 409 when it cannot. */
	rollback: (version: string) => Promise<UpdateStatus>;
	/** The versions this install has run, newest first. */
	history: () => Promise<{ entries: UpdateHistoryEntry[] }>;
	/** What the updater wrote while it installed one version. */
	historyLog: (id: string) => Promise<LogPage>;
	/** How a container install updates on its own; 409 outside container mode. */
	policy: () => Promise<UpdatePolicy>;
	setPolicy: (policy: UpdatePolicy) => Promise<UpdatePolicy>;
}

/** The review server's updater. */
export const updateApi: UpdateApi = {
	status: () => request<UpdateStatus>('/api/update'),
	check: () => post<UpdateStatus>('/api/update/check'),
	apply: () => post<UpdateStatus>('/api/update'),
	branches: () => request<UpdateBranches>('/api/update/branches'),
	switchBranch: (branch) => post<UpdateStatus>('/api/update/branch', { branch }),
	rollback: (version) => post<UpdateStatus>('/api/update/rollback', { version }),
	history: () => request<{ entries: UpdateHistoryEntry[] }>('/api/update/history'),
	historyLog: (id) => request<LogPage>(`/api/update/history/${seg(id)}/log`),
	policy: () => request<UpdatePolicy>('/api/update/policy'),
	setPolicy: (policy) => put<UpdatePolicy>('/api/update/policy', policy)
};
