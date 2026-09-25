import { env } from '$env/dynamic/public';
import type { DiscoveredModel,
	CodexConnection,
	CodexModel,
	ApplyFixRequest,
	ApplyFixResponse,
	CreateRepoInput,
	CreateReviewInput,
	DiscussRequest,
	DiscussResponse,
	FileDiff,
	GlobalGuidelines,
	GuidelinesDraftRequest,
	GuidelinesOverview,
	GuidelinesProposal,
	HomeBriefRequest,
	HomeBriefResponse,
	ModelSettings,
	ModelSettingsPatch,
	Provider,
	ProviderAuth,
	PullPreview,
	PullRequest,
	RemoteRepo,
	Repo,
	RepoGuidelines,
	PrCheck,
	Review,
	ReviewChatMessage,
	ReviewCodeContext,
	ReviewMetrics,
	RereviewRequest,
	RereviewResponse,
	SuggestFixRequest,
	SuggestFixResponse
} from '@recoder/shared';

const base = (env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/** API origin for non-fetch uses (e.g. EventSource). */
export const apiBase = base;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${base}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', ...init?.headers }
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `API ${res.status}`);
	}
	return (await res.json()) as T;
}

/** Read a `data: {...}` server-sent event stream, one parsed payload per event. */
async function readSse(res: Response, onEvent: (data: unknown) => void): Promise<void> {
	if (!res.ok || !res.body) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `API ${res.status}`);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buffer.indexOf('\n\n')) >= 0) {
			const event = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			for (const line of event.split('\n')) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data:')) onEvent(JSON.parse(trimmed.slice(5).trim()));
			}
		}
	}
}

export function detectProvider(url: string): 'github' | 'gitlab' {
	return /gitlab\./i.test(url) ? 'gitlab' : 'github';
}

export const serverApi = {
	getCodexStatus: () => req<CodexConnection>('/api/settings/codex/status'),
	connectCodex: () => req<CodexConnection>('/api/settings/codex/connect', { method: 'POST' }),
	disconnectCodex: () => req<{ ok: boolean }>('/api/settings/codex/disconnect', { method: 'POST' }),
	getCodexModels: () => req<CodexModel[]>('/api/settings/codex/models'),
	listRepos: () => req<Repo[]>('/api/repos'),
	createRepo: (input: CreateRepoInput) =>
		req<Repo>('/api/repos', { method: 'POST', body: JSON.stringify(input) }),
	previewPr: (repoId: string, n: number) =>
		req<PullPreview>(`/api/repos/${repoId}/pulls/${n}`),
	deleteRepo: (id: string) => req<{ deleted: boolean }>(`/api/repos/${id}`, { method: 'DELETE' }),
	listPrs: (repoId: string) => req<PullRequest[]>(`/api/repos/${repoId}/pulls`),
	listReviews: () => req<Review[]>('/api/reviews'),
	/** AI brief for Home, written by the orchestrator's model. */
	homeBrief: (input: HomeBriefRequest, signal?: AbortSignal) =>
		req<HomeBriefResponse>('/api/home/brief', { method: 'POST', body: JSON.stringify(input), signal }),
	/** Compact live progress per review (tasks settled/total, active specialists). */
	reviewSummaries: () =>
		req<Record<string, { tasksDone: number; tasksTotal: number; specialists: number }>>(
			'/api/reviews/progress-summaries'
		),
	getReview: (id: string, signal?: AbortSignal) => req<Review>(`/api/reviews/${id}`, { signal }),
	sendReviewMessage: (id: string, assignmentId: string, text: string, codeContext?: ReviewCodeContext) =>
		req<ReviewChatMessage>(`/api/reviews/${id}/chat`, { method: 'POST', body: JSON.stringify({ assignmentId, text, codeContext }) }),
	stopReviewMessage: (id: string, assignmentId: string) =>
		req<{ stopped: boolean }>(`/api/reviews/${id}/chat/stop`, { method: 'POST', body: JSON.stringify({ assignmentId }) }),
	getReviewMetrics: (id: string, signal?: AbortSignal) => req<ReviewMetrics | null>(`/api/reviews/${id}/metrics`, { signal }),
	getReviewFiles: (id: string, signal?: AbortSignal) => req<FileDiff[]>(`/api/reviews/${id}/files`, { signal }),
	discuss: (reviewId: string, input: DiscussRequest) =>
		req<DiscussResponse>(`/api/reviews/${reviewId}/discuss`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	/**
	 * Stream a follow-up reply as server-sent events. Forwards each token to
	 * `onToken` and resolves with the final reply once `done` arrives.
	 */
	discussStream: async (
		reviewId: string,
		input: DiscussRequest,
		onToken: (text: string) => void,
		signal?: AbortSignal
	): Promise<DiscussResponse> => {
		const res = await fetch(`${base}/api/reviews/${reviewId}/discuss/stream`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input),
			signal
		});
		let result: DiscussResponse | null = null;
		await readSse(res, (raw) => {
			const data = raw as { type: 'token'; text: string } | ({ type: 'done' } & DiscussResponse) | { type: 'error'; error: string };
			if (data.type === 'token') onToken(data.text);
			else if (data.type === 'done') result = data;
			else if (data.type === 'error') throw new Error(data.error);
		});
		if (!result) throw new Error('The reviewer did not respond.');
		return result;
	},
	/** Owner review guidelines: the global layer and per-repo `.recoder/REVIEW.md`. */
	getGuidelines: () => req<GuidelinesOverview>('/api/guidelines'),
	saveGlobalGuidelines: (content: string) =>
		req<GlobalGuidelines>('/api/guidelines/global', { method: 'PUT', body: JSON.stringify({ content }) }),
	getRepoGuidelines: (repoId: string) => req<RepoGuidelines>(`/api/guidelines/repos/${encodeURIComponent(repoId)}`),
	/** Open a pull/merge request with the file (or push to the pending one). */
	proposeRepoGuidelines: (repoId: string, content: string) =>
		req<GuidelinesProposal>(`/api/guidelines/repos/${encodeURIComponent(repoId)}/propose`, { method: 'POST', body: JSON.stringify({ content }) }),
	/** Stream a draft from the orchestrator; resolves with the cleaned full text. */
	draftGuidelines: async (input: GuidelinesDraftRequest, onToken: (text: string) => void, signal?: AbortSignal): Promise<string> => {
		const res = await fetch(`${base}/api/guidelines/draft`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input),
			signal
		});
		let text: string | null = null;
		await readSse(res, (raw) => {
			const data = raw as { type: 'token'; text: string } | { type: 'done'; text: string } | { type: 'error'; error: string };
			if (data.type === 'token') onToken(data.text);
			else if (data.type === 'done') text = data.text;
			else throw new Error(data.error);
		});
		if (text === null) throw new Error('The orchestrator did not respond.');
		return text;
	},
	/** Batch re-review pass driven by the developer's notes. */
	rereview: (reviewId: string, input: RereviewRequest) =>
		req<RereviewResponse>(`/api/reviews/${reviewId}/rereview`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	suggestFix: (reviewId: string, input: SuggestFixRequest) =>
		req<SuggestFixResponse>(`/api/reviews/${reviewId}/fixes/suggest`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	applyFix: (reviewId: string, input: ApplyFixRequest) =>
		req<ApplyFixResponse>(`/api/reviews/${reviewId}/fixes/apply`, {
			method: 'POST',
			body: JSON.stringify(input)
		}),
	queueReview: (input: CreateReviewInput) =>
		req<Review>('/api/reviews', { method: 'POST', body: JSON.stringify(input) }),
	/** CI checks for the PR head, or `ref` (a branch or sha, e.g. a fix's verify branch). */
	getChecks: (id: string, ref?: string) =>
		req<{ ref: string; provider?: string; checks: PrCheck[] }>(`/api/reviews/${id}/checks${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
	/** Push a fix to a temporary branch so CI runs on it (the PR branch is untouched). */
	verifyFix: (id: string, input: ApplyFixRequest & { key: string }) =>
		req<{ branch: string; sha: string }>(`/api/reviews/${id}/fixes/verify`, { method: 'POST', body: JSON.stringify(input) }),
	deleteVerifyBranch: (id: string, branch: string) =>
		req<{ deleted: boolean }>(`/api/reviews/${id}/fixes/verify?branch=${encodeURIComponent(branch)}`, { method: 'DELETE' }),
	/** Start a draft (interactive) review's full pipeline. */
	startReview: (id: string) => req<Review>(`/api/reviews/${id}/start`, { method: 'POST' }),
	cancelReview: (id: string) => req<{ cancelled: boolean }>(`/api/reviews/${id}/cancel`, { method: 'POST' }),
	pauseReview: (id: string) => req<{ paused: boolean }>(`/api/reviews/${id}/pause`, { method: 'POST' }),
	resumeReview: (id: string) => req<{ paused: boolean }>(`/api/reviews/${id}/resume`, { method: 'POST' }),
	deleteReview: (id: string) =>
		req<{ deleted: boolean }>(`/api/reviews/${id}`, { method: 'DELETE' }),
	authStatus: () => req<{ github: ProviderAuth; gitlab: ProviderAuth }>('/api/auth/status'),
	saveToken: (provider: Provider, token: string, host?: string) =>
		req<{ provider: Provider; user: string | null }>('/api/auth/token', {
			method: 'POST',
			body: JSON.stringify({ provider, token, ...(host !== undefined ? { host } : {}) })
		}),
	clearToken: (provider: Provider) =>
		req<{ cleared: boolean }>(`/api/auth/token/${provider}`, { method: 'DELETE' }),
	remoteRepos: (provider: Provider) => req<RemoteRepo[]>(`/api/auth/repos?provider=${provider}`),
	getModelSettings: () => req<ModelSettings>('/api/settings/models'),
	/** What an OpenAI-compatible endpoint serves; `baseUrl` comes back corrected (e.g. with `/v1`). */
	discoverModels: (input: { baseUrl?: string; apiKey?: string }) =>
		req<{ baseUrl: string; models: DiscoveredModel[] }>('/api/settings/models/discover', { method: 'POST', body: JSON.stringify(input) }),
	saveModelSettings: (patch: ModelSettingsPatch) =>
		req<ModelSettings>('/api/settings/models', { method: 'PUT', body: JSON.stringify(patch) })
};
