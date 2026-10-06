import type { Finding, ModelSettings, Repo, Review, ReviewProgress } from '@recoder/shared';
import type { CandidateOutcome } from '../review/pipeline/candidate-outcome';
import type { ServerIdentity } from './server-identity';

/** Live task and reviewer counts for one review, as the home dashboard reads them. */
export interface ProgressSummary {
	tasksDone: number;
	tasksTotal: number;
	agents: number;
}

/** Fetches a JSON route on the Recoder server; a non-2xx answer throws with the server's error message. */
async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(new URL(path, base), {
		...init,
		headers: { 'Content-Type': 'application/json', ...init?.headers }
	});

	const body = (await response.json().catch(() => null)) as { error?: string } | null;

	if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${body?.error ?? response.status}`);

	return body as T;
}

/** The server's reviewer settings, as the Settings page reads them. */
export function getSettings(base: string): Promise<ModelSettings> {
	return request<ModelSettings>(base, '/api/settings/models');
}

/** The server's flags, limits, cache versions, tools and checkout; null from a server older than `/health/identity`. */
export function getServerIdentity(base: string): Promise<ServerIdentity | null> {
	return request<ServerIdentity>(base, '/health/identity').catch(() => null);
}

/** The tracked repo the eval was pointed at, by id, `owner/name` or URL. */
export async function resolveRepo(base: string, query: string): Promise<Repo> {
	const repos = await request<Repo[]>(base, '/api/repos');
	const wanted = query.replace(/\.git$/, '').replace(/\/$/, '');

	const repo = repos.find(
		(candidate) =>
			candidate.id === wanted ||
			candidate.name === wanted ||
			candidate.url.replace(/\.git$/, '').replace(/\/$/, '') === wanted ||
			candidate.url.replace(/\.git$/, '').endsWith(`/${wanted}`)
	);

	if (!repo) {
		const known = repos.map((candidate) => `${candidate.name} (${candidate.id})`).join(', ') || 'none';

		throw new Error(`No tracked repo matches "${query}". Tracked repos: ${known}`);
	}

	return repo;
}

/**
 * Queues a new automated review. The server mints a new review id each time
 * and nothing compares it with earlier reviews of the PR, so it is a full review.
 */
export function startReview(base: string, repoId: string, prNumber: number, baselineCache = true): Promise<Review> {
	return request<Review>(base, '/api/reviews', {
		method: 'POST',
		body: JSON.stringify({ repoId, prNumber, start: true, ...(baselineCache ? {} : { baselineCache: false }) })
	});
}

/** Replays a passed review from its kept checkpoint, without its reviewers; `reverify` verifies every candidate again. */
export function replayReview(base: string, reviewId: string, reverify: boolean): Promise<Review> {
	return request<Review>(base, `/api/reviews/${reviewId}/replay`, {
		method: 'POST',
		body: JSON.stringify({ reverify })
	});
}

export function getReview(base: string, reviewId: string): Promise<Review> {
	return request<Review>(base, `/api/reviews/${reviewId}`);
}

/** Every candidate a review raised, with the stage that stopped it; null from a server that cannot list them or a review that kept none. */
export async function getCandidates(base: string, reviewId: string): Promise<(Finding & CandidateOutcome)[] | null> {
	return request<(Finding & CandidateOutcome)[]>(base, `/api/reviews/${reviewId}/candidates`).catch(() => null);
}

/** Stops a running review; one that already stopped answers 409, which is fine here. */
export async function cancelReview(base: string, reviewId: string): Promise<void> {
	await fetch(new URL(`/api/reviews/${reviewId}/cancel`, base), { method: 'POST' }).catch(() => undefined);
}

/** Task and reviewer counts for the progress line; null when the server has none for this review. */
export async function progressSummary(base: string, reviewId: string): Promise<ProgressSummary | null> {
	const summaries = await request<Record<string, ProgressSummary>>(base, '/api/reviews/progress-summaries');

	return summaries[reviewId] ?? null;
}

/** The JSON of the first server-sent event in `text`, or undefined while it hasn't fully arrived. */
function firstEvent(text: string): unknown {
	const end = text.indexOf('\n\n');

	if (end === -1) return undefined;

	const data = text
		.slice(0, end)
		.split('\n')
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trimStart())
		.join('\n');

	return JSON.parse(data);
}

/**
 * The review's stored progress. There is no plain GET for it: the event
 * stream opens with a snapshot, so this reads that first event and hangs up.
 */
export async function readProgress(base: string, reviewId: string): Promise<ReviewProgress | null> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), 15_000);

	try {
		const response = await fetch(new URL(`/api/reviews/${reviewId}/events`, base), { signal: abort.signal });

		if (!response.ok || !response.body) return null;

		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let text = '';

		while (true) {
			const { value, done } = await reader.read();

			if (done) return null;
			text += value;

			const event = firstEvent(text) as { type?: string; snapshot?: ReviewProgress } | undefined;

			if (event !== undefined) return event.type === 'snapshot' ? (event.snapshot ?? null) : null;
		}
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		abort.abort();
	}
}

/** The hidden-candidate count the review summary states ("3 unproven candidates hidden"), or null when it states none. */
export function hiddenFromSummary(summary: string | null): number | null {
	const match = summary?.match(/(\d+)\s+unproven\s+candidates?\b[^.]*?\bhidden/i);

	return match ? Number(match[1]) : null;
}
