import type {
	BackupPolicy,
	BackupsState,
	LogLevel,
	LogPage,
	LogSource,
	ServerChecks,
	ServerOverview,
	UpdateStatus
} from '@recoder/shared';

import { API_BASE, del, post, put, request, seg } from './http';

/** Which log lines to read: older than `before` (a line's `seq`), from one source, at one level and above. */
export interface LogQuery {
	before?: number;
	source?: LogSource;
	level?: LogLevel;
}

/** The query string a log read sends, without the empty parts. */
function logSearch({ before, source, level }: LogQuery): string {
	const params = new URLSearchParams();

	if (before !== undefined) params.set('before', String(before));
	if (source) params.set('source', source);
	if (level) params.set('level', level);

	const search = params.toString();

	return search ? `?${search}` : '';
}

/**
 * Settings → Server's calls (plans/AID-deploy-api.md in the Captain drive). All of them are the admin's: a member gets
 * 403 `admin-only`. The checks are also the setup checklist's last step.
 */
export const serverApi = {
	overview: () => request<ServerOverview>('/api/server'),
	checks: () => request<ServerChecks>('/api/server/checks'),
	/** Runs every check again, the review model's one call included; answers at once with `running: true`. */
	runChecks: () => post<ServerChecks>('/api/server/checks'),
	backups: () => request<BackupsState>('/api/server/backups'),
	backUp: () => post<BackupsState>('/api/server/backups'),
	setBackupPolicy: (policy: BackupPolicy) => put<BackupsState>('/api/server/backups/policy', policy),
	deleteBackup: (id: string) => del<BackupsState>(`/api/server/backups/${seg(id)}`),
	/** Restores a backup: the server restarts through its updater, so the answer is the updater's status. */
	restoreBackup: (id: string) => post<UpdateStatus>(`/api/server/backups/${seg(id)}/restore`),
	/** Where the browser downloads a backup; `key` adds the secret key that opens its sealed credentials. */
	backupUrl: (id: string, key: boolean) => `${API_BASE}/api/server/backups/${seg(id)}/download${key ? '?key=1' : ''}`,
	logs: (query: LogQuery) => request<LogPage>(`/api/server/logs${logSearch(query)}`),
	/** The stream of new log lines, one `line` event each. */
	logEventsUrl: () => `${API_BASE}/api/server/logs/events`
};
