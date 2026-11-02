import type { AutoReviewPayload, AutoReviewSettings } from '@recoder/shared';

import { post, put, request } from './http';

/** The watcher that starts reviews on its own: its settings, how it is doing, and a check on demand. */
export const autoReviewApi = {
	get: () => request<AutoReviewPayload>('/api/settings/auto-review'),
	save: (patch: Partial<AutoReviewSettings>) => put<AutoReviewPayload>('/api/settings/auto-review', patch),
	/** Runs one round of checks now and answers once it is done. */
	check: () => post<AutoReviewPayload>('/api/settings/auto-review/check')
};
