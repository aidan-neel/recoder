import type {
	MergePullInput,
	MergePullResult,
	PrCheck,
	PullComment,
	PullCommit,
	PullDiff,
	PullList,
	PullPage
} from '@recoder/shared';

import { post, request, seg } from './http';

/** Which open pull requests to list: one repository's, and whether to skip the server's cache. */
export interface PullListQuery {
	repoId?: string;
	fresh?: boolean;
}

/** The path of one pull request's routes. */
function pullPath(repoId: string, number: number): string {
	return `/api/repos/${seg(repoId)}/pulls/${seg(number)}`;
}

/** The query string of a list request; empty when it asks for nothing special. */
function listSearch(query: PullListQuery): string {
	const params = new URLSearchParams();

	if (query.repoId) params.set('repoId', query.repoId);
	if (query.fresh) params.set('fresh', '1');

	const search = params.toString();

	return search ? `?${search}` : '';
}

/** Open pull requests across the tracked repositories, and one pull request's page, diff, commits, checks, conversation and merge. */
export const pullsApi = {
	list: (query: PullListQuery = {}) => request<PullList>(`/api/pulls${listSearch(query)}`),
	page: (repoId: string, number: number) => request<PullPage>(`${pullPath(repoId, number)}/page`),
	diff: (repoId: string, number: number) => request<PullDiff>(`${pullPath(repoId, number)}/diff`),
	commits: (repoId: string, number: number) => request<PullCommit[]>(`${pullPath(repoId, number)}/commits`),
	checks: (repoId: string, number: number) => request<PrCheck[]>(`${pullPath(repoId, number)}/checks`),
	comments: (repoId: string, number: number) => request<PullComment[]>(`${pullPath(repoId, number)}/comments`),

	comment: (repoId: string, number: number, body: string) =>
		post<PullComment>(`${pullPath(repoId, number)}/comments`, { body }),

	merge: (repoId: string, number: number, input: MergePullInput) =>
		post<MergePullResult>(`${pullPath(repoId, number)}/merge`, input)
};
