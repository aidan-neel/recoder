import type { AutoReviewPayload, AutoReviewSettings } from '@recoder/shared';

/** The payload the fake auto-review server answers with. */
export function autoReviewPayload(settings: AutoReviewSettings): AutoReviewPayload {
	return {
		settings,
		status: { running: false, watching: 0, lastCheckAt: null, nextCheckAt: null, errors: [], recent: [] },
		webhookPaths: { gitlab: '/api/webhooks/gitlab', github: '/api/webhooks/github' }
	};
}
