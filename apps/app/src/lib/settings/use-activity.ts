'use client';

import { shortAge, type Repo } from '@recoder/shared';

import { API_BASE } from '../api/http';
import { pullRef } from '../shell/format';
import { reviewHref } from '../shell/routes';
import { reasonText } from './auto-review-text';
import { useAutoReview } from './auto-review-store';

/** One review the watcher started, as its Recent row shows it. */
export interface RecentRow {
	reviewId: string;
	/** `api #214`, by the repository's name. */
	name: string;
	/** Why it started and how long ago, e.g. "Mentioned by @aidan · 5m ago". */
	description: string;
	/** The review's page. */
	href: string;
}

/** Everything the Recent group shows. */
export interface RecentActivity {
	rows: RecentRow[];
}

/**
 * Settings → Auto-review → Recent: the latest reviews the watcher started,
 * each a link to its review. `repos` names the repositories the events name.
 */
export function useRecentActivity(repos: Repo[]): RecentActivity {
	const recent = useAutoReview((state) => state.payload?.status.recent ?? []);

	const rows = recent.map((event) => {
		const repo = repos.find((item) => item.id === event.repoId)?.name ?? 'repository';
		const age = shortAge(event.at);
		const reason = reasonText(event);

		return {
			reviewId: event.reviewId,
			name: pullRef(repo, event.prNumber),
			description: age ? `${reason} · ${age} ago` : reason,
			href: reviewHref(event.reviewId)
		};
	});

	return { rows };
}

/** One forge's webhook address, as its row shows it. */
export interface WebhookRow {
	forge: 'GitLab' | 'GitHub';
	/** The full address a webhook posts to. */
	url: string;
}

/** Everything the Webhooks group shows; `rows` is null while the payload has not landed. */
export interface WebhookActivity {
	rows: WebhookRow[] | null;
}

/**
 * Settings → Auto-review → Webhooks: where a forge can report events instead
 * of waiting for the next check. Null until the payload lands.
 */
export function useWebhookActivity(): WebhookActivity {
	const paths = useAutoReview((state) => state.payload?.webhookPaths ?? null);

	return {
		rows: paths
			? [
					{ forge: 'GitLab', url: `${API_BASE}${paths.gitlab}` },
					{ forge: 'GitHub', url: `${API_BASE}${paths.github}` }
				]
			: null
	};
}
