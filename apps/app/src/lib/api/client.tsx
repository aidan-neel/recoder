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
	ProgressMessage,
	PullPage,
	Repo,
	RepoChat,
	RepoChatEvent,
	RepoChatMessage,
	RepoChatSummary,
	RepoFile,
	RepoTree,
	Review,
	ReviewChatMessage,
	ReviewListItem,
	SendRepoChatInput,
	StartRepoChatInput
} from '@recoder/shared';
import { ORCHESTRATOR_ID } from '@recoder/shared';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { createChatCache, type ChatCache } from '../chat/chat-cache';
import { createSessionCache, type SessionCache } from '../pull/session-cache';
import { createListStore, type ListStore } from '../pulls/list-store';
import { accountsApi, type AuthApi } from './accounts';
import { chatApi } from './chat';
import { chatsApi, startRepoChat } from './chats';
import { connectionsApi } from './connections';
import { filesApi } from './files';
import { EventStream, type StreamHandlers } from './event-stream';
import { seg } from './http';
import { membersApi, type MembersApi } from './members';
import { pullsApi, type PullListQuery } from './pulls';
import { reviewsApi, type DecisionInput } from './reviews';
import { updateApi, type UpdateApi } from './update';
import { usageApi, type UsageApi } from './usage';

/**
 * Every call the screens make to the review server. The live client talks to
 * the server; the sample client answers from memory, so `/sample` and the
 * site's demo run the same screens with no server.
 */
export interface ApiClient {
	/** What every page address starts with: `''` live, `'/sample'` for the sample. */
	readonly base: string;
	/** The Recoder account: who is signed in, and the sign-in that makes or extends one. */
	auth: AuthApi;
	/** The people the admin lets in. */
	members: MembersApi;
	/** What each person and model has used, for the admin. */
	usage: UsageApi;
	/** Updating this Recoder install, for the admin. */
	update: UpdateApi;
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
	/** Removes a review for good. */
	deleteReview: (id: string) => Promise<void>;
	decide: (reviewId: string, findingId: string, input: DecisionInput) => Promise<FindingDecision>;
	reopen: (reviewId: string, findingId: string) => Promise<void>;
	markUseful: (reviewId: string, findingId: string) => Promise<void>;
	unmarkUseful: (reviewId: string, findingId: string) => Promise<void>;
	unquiet: (reviewId: string, topicId: string) => Promise<void>;
	postFinding: (reviewId: string, findingId: string) => Promise<Review>;
	/** Posts every open finding of the review on its pull request; resolves with the review as it then stands. */
	postFindings: (reviewId: string) => Promise<Review>;
	/** Follows a review's live events until the returned stop is called. */
	follow: (reviewId: string, handlers: StreamHandlers<ProgressMessage>) => () => void;
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
	/** The chats most recently active across every repository, newest first, at most `limit`. */
	repoChats: (limit: number) => Promise<RepoChatSummary[]>;
	/** A chat with Recoder about one tracked repository. */
	repoChat: (chatId: string) => Promise<RepoChat>;
	/** Opens a chat on a tracked repository with its first message; resolves with the chat's id. */
	startRepoChat: (input: StartRepoChatInput) => Promise<{ id: string }>;
	/** Sends a message to a chat; the reply arrives on its events. */
	sendRepoChat: (chatId: string, message: SendRepoChatInput) => Promise<RepoChatMessage>;
	/** Stops the reply `messageId` if it is still being written; a reply that already closed stays as it is. */
	stopRepoChat: (chatId: string, messageId: string) => Promise<void>;
	/** Removes a chat for good. */
	deleteRepoChat: (chatId: string) => Promise<void>;
	/** Follows a chat's live events until the returned stop is called. */
	followRepoChat: (chatId: string, handlers: StreamHandlers<RepoChatEvent>) => () => void;
	/** One directory of a repository at `ref` (the default branch when omitted); the empty path is the root. */
	repoTree: (repoId: string, path: string, ref?: string) => Promise<RepoTree>;
	/** One file of a repository at `ref` (the default branch when omitted). */
	repoFile: (repoId: string, path: string, ref?: string) => Promise<RepoFile>;
}

/** The first signed-in forge's login. */
async function signedInLogin(): Promise<string | null> {
	const status = await connectionsApi.status();

	return status.github.user ?? status.gitlab.user ?? null;
}

/** Opens a server event stream and hands back its stop. */
function followStream<Message>(path: string, handlers: StreamHandlers<Message>): () => void {
	const stream = new EventStream(path, handlers);

	stream.open();

	return () => stream.close();
}

/** The review server. */
export const liveApi: ApiClient = {
	base: '',
	auth: accountsApi,
	members: membersApi,
	usage: usageApi,
	update: updateApi,
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
	deleteReview: async (id) => void (await reviewsApi.delete(id)),
	decide: reviewsApi.decide,
	reopen: async (reviewId, findingId) => void (await reviewsApi.reopen(reviewId, findingId)),
	markUseful: async (reviewId, findingId) => void (await reviewsApi.markUseful(reviewId, findingId)),
	unmarkUseful: async (reviewId, findingId) => void (await reviewsApi.unmarkUseful(reviewId, findingId)),
	unquiet: async (reviewId, topicId) => void (await reviewsApi.unquiet(reviewId, topicId)),
	postFinding: reviewsApi.postFinding,
	postFindings: reviewsApi.postFindings,
	follow: (reviewId, handlers) => followStream(`/api/reviews/${seg(reviewId)}/events`, handlers),
	sendChat: (reviewId, text) => chatApi.send(reviewId, ORCHESTRATOR_ID, text),
	stopChat: async (reviewId) => void (await chatApi.stop(reviewId, ORCHESTRATOR_ID)),
	discuss: chatApi.discuss,
	repoChats: chatsApi.recent,
	repoChat: chatsApi.chat,
	startRepoChat,
	sendRepoChat: chatsApi.send,
	stopRepoChat: async (chatId, messageId) => void (await chatsApi.stop(chatId, messageId)),
	deleteRepoChat: chatsApi.delete,
	followRepoChat: (chatId, handlers) => followStream(`/api/chats/${seg(chatId)}/events`, handlers),
	repoTree: filesApi.tree,
	repoFile: filesApi.file
};

interface ApiContext {
	client: ApiClient;
	list: ListStore;
	/** Pull request pages kept from earlier visits, so returning paints from what they already read. */
	sessions: SessionCache;
	/** Chats kept from earlier visits; hovering a chat's row reads it ahead of the click. */
	chats: ChatCache;
}

const Context = createContext<ApiContext | null>(null);

/**
 * Gives the screens below it a client and the one pull request list they
 * share, so the sidebar, the list and the New review screen never fetch it twice.
 */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
	const [value] = useState(() => {
		const list = createListStore(client);

		return { client, list, sessions: createSessionCache(client, list), chats: createChatCache(client) };
	});

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

/** The pull request sessions the screens under the provider share. */
export function useSessionCache(): SessionCache {
	return useApiContext().sessions;
}

/** The chats the screens under the provider have read. */
export function useChatCache(): ChatCache {
	return useApiContext().chats;
}
