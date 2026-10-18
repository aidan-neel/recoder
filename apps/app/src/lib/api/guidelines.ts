import type {
	GlobalGuidelines,
	GuidelinesDraftRequest,
	GuidelinesOverview,
	GuidelinesProposal,
	RepoGuidelines
} from '@recoder/shared';

import { del, post, postStream, put, request, seg } from './http';
import { streamReply } from './stream-reply';

/** What reviewers follow: the global layer on this machine and each repository's `.recoder/REVIEW.md`. */
export const guidelinesApi = {
	overview: () => request<GuidelinesOverview>('/api/guidelines'),
	saveGlobal: (content: string) => put<GlobalGuidelines>('/api/guidelines/global', { content }),

	/** Deletes the saved global layer, so it reads as never saved and Recoder's defaults apply. */
	resetGlobal: () => del<GlobalGuidelines>('/api/guidelines/global'),
	repo: (repoId: string) => request<RepoGuidelines>(`/api/guidelines/repos/${seg(repoId)}`),

	/** Opens a pull request with the file, or pushes to the one already pending. */
	propose: (repoId: string, content: string) =>
		post<GuidelinesProposal>(`/api/guidelines/repos/${seg(repoId)}/propose`, { content }),

	/** Streams a draft from the orchestrator. Resolves with the cleaned full text. */
	async draft(input: GuidelinesDraftRequest, onToken: (text: string) => void, signal?: AbortSignal): Promise<string> {
		const done = await streamReply<{ text: string }>(
			(onEvent) => postStream('/api/guidelines/draft', input, onEvent, signal),
			onToken
		);

		return done.text;
	}
};
