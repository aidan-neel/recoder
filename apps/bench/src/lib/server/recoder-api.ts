import type { ModelSettings, Review } from '@recoder/shared';
import type { HostConfig } from '$lib/reports/types';
import { getSettings as readSettings, readProgress } from '$server/eval/client';
import { reach } from './tunnel';

/** Task and reviewer counts per review, as the server's home dashboard reads them. */
export type ProgressSummaries = Record<string, { tasksDone: number; tasksTotal: number; agents: number }>;

/** A task in a review's progress snapshot. */
interface SnapshotTask {
	label: string;
	message?: string;
	status: string;
	startedAt: string | null;
}

/** The parts of a review's progress snapshot the live view shows. */
export interface Snapshot {
	orchestratorModel: string | null;
	tasks: SnapshotTask[];
}

/** A review as the list route returns it, without the findings this app has no use for. */
export type ReviewRow = Pick<Review, 'id' | 'repoId' | 'prNumber' | 'status' | 'headSha'> & {
	createdAt: string;
	startedAt?: string | null;
};

/** A read-only GET against the host's server; the devtool never writes through this API. */
async function request<T>(target: HostConfig, base: string, path: string): Promise<T> {
	const url = new URL(path, await reach(target, base));
	const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	const body = (await response.json().catch(() => null)) as { error?: string } | null;

	if (!response.ok) throw new Error(`GET ${path}: ${body?.error ?? response.status}`);

	return body as T;
}

export async function getSettings(target: HostConfig, base: string): Promise<ModelSettings> {
	return readSettings(await reach(target, base));
}

export function getSummaries(target: HostConfig, base: string): Promise<ProgressSummaries> {
	return request(target, base, '/api/reviews/progress-summaries');
}

/**
 * Every review on the server. The list carries each review's findings, so it
 * is large on a server with history; callers cache it.
 */
export async function getReviews(target: HostConfig, base: string): Promise<ReviewRow[]> {
	const reviews = await request<(ReviewRow & Record<string, unknown>)[]>(target, base, '/api/reviews');

	return reviews.map(({ id, repoId, prNumber, status, headSha, createdAt, startedAt }) => ({
		id,
		repoId,
		prNumber,
		status,
		headSha,
		createdAt,
		startedAt
	}));
}

/** The tracked repos, so a review's repo id can be matched to a dataset's forge URL. */
export function getRepos(target: HostConfig, base: string): Promise<{ id: string; url: string; name: string }[]> {
	return request(target, base, '/api/repos');
}

/** A review's running tasks and its locked model, from its progress snapshot. */
export async function getSnapshot(target: HostConfig, base: string, reviewId: string): Promise<Snapshot | null> {
	const progress = await readProgress(await reach(target, base), reviewId);

	if (!progress) return null;

	return {
		orchestratorModel: progress.orchestratorModel ?? null,
		tasks: Object.values(progress.tasks).map((task) => ({
			label: task.label,
			message: task.message,
			status: task.status,
			startedAt: task.startedAt ?? null
		}))
	};
}
