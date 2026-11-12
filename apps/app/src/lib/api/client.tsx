'use client';

import type {
	CreateRepoInput,
	CreateReviewInput,
	DiscussRequest,
	DiscussResponse,
	FindingDecision,
	MergePullInput,
	MergePullResult,
	PrCheck,
	PullComment,
	PullCommit,
	PullDiff,
	PullList,
	PullPage,
	Repo,
	Review,
	ReviewChatMessage,
	ReviewListItem
} from '@recoder/shared';
import { ORCHESTRATOR_ID } from '@recoder/shared';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { createListStore, type ListStore } from '../pulls/list-store';
import { ReviewStream, type StreamHandlers } from '../review/review-stream';
import { chatApi } from './chat';
import { connectionsApi } from './connections';
import { pullsApi, type PullListQuery } from './pulls';
import { reviewsApi, type DecisionInput } from './reviews';

/**
 * Every call the screens make to the review server. The live client talks to
 * the server; the sample client answers from memory, so `/sample` and the
 * site's demo run the same screens with no server.
 */
export interface ApiClient {
	/** What every page address starts with: `''` live, `'/sample'` for the sample. */
	readonly base: string;
	/** The signed-in forge login, or null when no forge is signed in. */
	account: () => Promise<string | null>;
	repos: () => Promise<Repo[]>;
	addRepo: (input: CreateRepoInput) => Promise<Repo>;
	pulls: (query?: PullListQuery) => Promise<PullList>;
	pullPage: (repoId: string, number: number) => Promise<PullPage>;
	pullDiff: (repoId: string, number: number) => Promise<PullDiff>;
	pullCommits: (repoId: string, number: number) => Promise<PullCommit[]>;
	pullChecks: (repoId: string, number: number) => Promise<PrCheck[]>;
	pullComments: (repoId: string, number: number) => Promise<PullComment[]>;
	postPullComment: (repoId: string, number: number, body: string) => Promise<PullComment>;
	mergePull: (repoId: string, number: number, input: MergePullInput) => Promise<MergePullResult>;
	reviews: () => Promise<ReviewListItem[]>;
	review: (id: string) => Promise<Review>;
	createReview: (input: CreateReviewInput) => Promise<Review>;
	startDraft: (id: string) => Promise<Review>;
	continueReview: (id: string) => Promise<Review>;
	pauseReview: (id: string) => Promise<void>;
	resumeReview: (id: string) => Promise<void>;
	cancelReview: (id: string) => Promise<void>;
	decide: (reviewId: string, findingId: string, input: DecisionInput) => Promise<FindingDecision>;
	reopen: (reviewId: string, findingId: string) => Promise<void>;
	markUseful: (reviewId: string, findingId: string) => Promise<void>;
	unmarkUseful: (reviewId: string, findingId: string) => Promise<void>;
	unquiet: (reviewId: string, topicId: string) => Promise<void>;
	postFinding: (reviewId: string, findingId: string) => Promise<Review>;
	/** Posts every open finding of the review on its pull request; resolves with the review as it then stands. */
	postFindings: (reviewId: string) => Promise<Review>;
	/** Follows a review's live events until the returned stop is called. */
	follow: (reviewId: string, handlers: StreamHandlers) => () => void;
	/** Sends a message to the review's conversation; the reply arrives on its events. */
	sendChat: (reviewId: string, text: string) => Promise<ReviewChatMessage>;
	stopChat: (reviewId: string) => Promise<void>;
	/** Asks about one finding; the reply streams token by token. */
	discuss: (
		reviewId: string,
		input: DiscussRequest,
		onToken: (text: string) => void,
		signal: AbortSignal
	) => Promise<DiscussResponse>;
}

/** The first signed-in forge's login. */
async function signedInLogin(): Promise<string | null> {
	const status = await connectionsApi.status();

	return status.github.user ?? status.gitlab.user ?? null;
}

/** Opens a review's event stream and hands back its stop. */
function followStream(reviewId: string, handlers: StreamHandlers): () => void {
	const stream = new ReviewStream(reviewId, handlers);

	stream.open();

	return () => stream.close();
}

/** The review server. */
export const liveApi: ApiClient = {
	base: '',
	account: signedInLogin,
	repos: reviewsApi.repos,
	addRepo: connectionsApi.addRepo,
	pulls: pullsApi.list,
	pullPage: pullsApi.page,
	pullDiff: pullsApi.diff,
	pullCommits: pullsApi.commits,
	pullChecks: pullsApi.checks,
	pullComments: pullsApi.comments,
	postPullComment: pullsApi.comment,
	mergePull: pullsApi.merge,
	reviews: reviewsApi.list,
	review: reviewsApi.review,
	createReview: reviewsApi.create,
	startDraft: reviewsApi.startDraft,
	continueReview: reviewsApi.continue,
	pauseReview: async (id) => void (await reviewsApi.pause(id)),
	resumeReview: async (id) => void (await reviewsApi.resume(id)),
	cancelReview: async (id) => void (await reviewsApi.cancel(id)),
	decide: reviewsApi.decide,
	reopen: async (reviewId, findingId) => void (await reviewsApi.reopen(reviewId, findingId)),
	markUseful: async (reviewId, findingId) => void (await reviewsApi.markUseful(reviewId, findingId)),
	unmarkUseful: async (reviewId, findingId) => void (await reviewsApi.unmarkUseful(reviewId, findingId)),
	unquiet: async (reviewId, topicId) => void (await reviewsApi.unquiet(reviewId, topicId)),
	postFinding: reviewsApi.postFinding,
	postFindings: reviewsApi.postFindings,
	follow: followStream,
	sendChat: (reviewId, text) => chatApi.send(reviewId, ORCHESTRATOR_ID, text),
	stopChat: async (reviewId) => void (await chatApi.stop(reviewId, ORCHESTRATOR_ID)),
	discuss: chatApi.discuss
};

interface ApiContext {
	client: ApiClient;
	list: ListStore;
}

const Context = createContext<ApiContext | null>(null);

/**
 * Gives the screens below it a client and the one pull request list they
 * share, so the sidebar, the list and the New review screen never fetch it twice.
 */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
	const [list] = useState(() => createListStore(client));
	const value = useMemo(() => ({ client, list }), [client, list]);

	return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useApiContext(): ApiContext {
	const context = useContext(Context);

	if (!context) throw new Error('useApi needs an ApiProvider above it.');

	return context;
}

/** The client of the nearest `ApiProvider`. */
export function useApi(): ApiClient {
	return useApiContext().client;
}

/** The pull request list the screens under the provider share. */
export function useListStore(): ListStore {
	return useApiContext().list;
}
