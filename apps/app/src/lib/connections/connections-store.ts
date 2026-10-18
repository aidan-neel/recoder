import type { CreateRepoInput, ProviderAuth, RemoteRepo, Repo } from '@recoder/shared';
import { create } from 'zustand';

import { connectionsApi, type Forge } from '../api/connections';
import { failureText, isOffline } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { repoKey } from './repo-input';

/** `offline`: the review server did not answer. `error`: it answered with one. */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

/** The repositories one forge's token can see, for the repo browser. `retrying` keeps the last error on screen while a retry runs. */
export interface RemoteList {
	status: 'loading' | 'ready' | 'error' | 'retrying';
	repos: RemoteRepo[];
	error: string | null;
}

type AuthMap = Record<Forge, ProviderAuth>;

interface ConnectionsStore {
	/** Who each forge is signed in as. Null until the first check answers. */
	auth: AuthMap | null;
	authStatus: LoadStatus;
	authError: string | null;
	/** The tracked repositories, in the order they were added, less those waiting on an Undo. Null until the first load answers. */
	repos: Repo[] | null;
	reposStatus: LoadStatus;
	reposError: string | null;
	remote: Partial<Record<Forge, RemoteList>>;
	/** Checks the forges again. A failed check after a good one keeps what is on screen, and so does a retry after a failure. */
	loadAuth: () => Promise<void>;
	/** Loads the tracked repositories again, keeping the list, or the failure, on screen until the answer lands. */
	loadRepos: () => Promise<void>;
	/** Lists what a forge's token can see; a list already loaded is kept, and a failed one is listed again. */
	loadRemote: (forge: Forge) => Promise<void>;
	/** Checks the token with the forge and keeps it. Rejects with the server's reason. */
	saveToken: (forge: Forge, token: string, host?: string) => Promise<void>;
	/** Forgets the saved token and resolves with the forge's sign-in after that (a CLI may still be signed in). */
	clearToken: (forge: Forge) => Promise<ProviderAuth | null>;
	/**
	 * Tracks a repository and adds it to the list. One waiting on Undo comes
	 * back as it was, with its id, instead of being tracked twice. Rejects with
	 * the server's reason.
	 */
	addRepo: (input: CreateRepoInput) => Promise<Repo>;
	/**
	 * Takes a repository off the list while the server still tracks it, so Undo
	 * can bring it back as it was. `cancel` calls off its pending removal and
	 * returns false once that removal has gone out.
	 */
	hideRepo: (repo: Repo, cancel: () => boolean) => void;
	/** Puts a hidden repository back in its place. */
	restoreRepo: (repo: Repo) => void;
	/** Stops tracking a repository on the server and drops it from the list; on failure it comes back. Rejects with the server's reason. */
	removeRepo: (repo: Repo) => Promise<void>;
}

/** How a failed load reads: offline when the server never answered, else its error. */
function failure(error: unknown, fallback: string): { status: LoadStatus; error: string | null } {
	return isOffline(error)
		? { status: 'offline', error: null }
		: { status: 'error', error: failureText(error, fallback) };
}

/** True when the last load failed. A retry keeps that on screen, so the notice and its pending button stay put. */
function failed(status: LoadStatus): boolean {
	return status === 'error' || status === 'offline';
}

export const useConnections = create<ConnectionsStore>(() => ({
	auth: null,
	authStatus: 'idle',
	authError: null,
	repos: null,
	reposStatus: 'idle',
	reposError: null,
	remote: {},
	loadAuth,
	loadRepos,
	loadRemote,
	saveToken,
	clearToken,
	addRepo,
	hideRepo,
	restoreRepo,
	removeRepo
}));

const get = useConnections.getState;
const set = useConnections.setState;

/**
 * Bumps when a repository load begins and when the list changes here. A load
 * applies only if nothing newer happened while it waited, so a slow answer
 * never brings back a repository just removed, or drops one just added.
 */
let repoSeq = 0;

/** Every tracked repository in the server's order, hidden ones included, so Undo puts a row back where it was. */
let tracked: Repo[] = [];

/** Repositories taken off the list while their Undo toast shows, each with what calls off its removal. The server tracks them until it goes. */
const hidden = new Map<string, () => boolean>();

/** Bumps per auth check, so only the latest answer lands. */
let authSeq = 0;

let authInflight: Promise<void> | null = null;

/** One sign-in check; only the latest check's answer lands, and a failure after a good check keeps it. */
async function checkAuth(mine: number): Promise<void> {
	if (!get().auth && !failed(get().authStatus)) set({ authStatus: 'loading' });

	try {
		const auth = await connectionsApi.status();

		if (mine === authSeq) set({ auth, authStatus: 'ready', authError: null });
	} catch (error) {
		if (mine !== authSeq || get().auth) return;

		const { status, error: reason } = failure(error, 'Couldn’t check the forges.');

		set({ authStatus: status, authError: reason });
	}
}

function loadAuth(): Promise<void> {
	if (authInflight) return authInflight;

	const done: Promise<void> = checkAuth(++authSeq).finally(() => {
		if (authInflight === done) authInflight = null;
	});

	authInflight = done;

	return done;
}

/** Puts the tracked list on screen, leaving out the repositories waiting on an Undo. */
function showRepos(list: Repo[]): void {
	tracked = list;
	set({ repos: list.filter((repo) => !hidden.has(repo.id)), reposStatus: 'ready', reposError: null });
}

async function loadRepos(): Promise<void> {
	const mine = ++repoSeq;

	if (!get().repos && !failed(get().reposStatus)) set({ reposStatus: 'loading' });

	try {
		const repos = await reviewsApi.repos();

		if (mine === repoSeq) showRepos(repos);
	} catch (error) {
		if (mine !== repoSeq || get().repos) return;

		const { status, error: reason } = failure(error, 'Couldn’t load the repositories.');

		set({ reposStatus: status, reposError: reason });
	}
}

function setRemote(forge: Forge, list: RemoteList): void {
	set({ remote: { ...get().remote, [forge]: list } });
}

async function loadRemote(forge: Forge): Promise<void> {
	const current = get().remote[forge];

	if (current?.status === 'loading' || current?.status === 'retrying' || current?.status === 'ready') return;

	setRemote(forge, current ? { ...current, status: 'retrying' } : { status: 'loading', repos: [], error: null });

	try {
		setRemote(forge, { status: 'ready', repos: await connectionsApi.remoteRepos(forge), error: null });
	} catch (error) {
		setRemote(forge, { status: 'error', repos: [], error: failureText(error, 'The forge didn’t answer.') });
	}
}

/** A new token can see other repositories, so the lists are fetched again next time. */
function forgetRemote(forge: Forge): void {
	const { [forge]: _old, ...rest } = get().remote;

	set({ remote: rest });
}

/** The server caches its sign-in check; a token change clears that cache, so this check is fresh. */
async function recheck(): Promise<void> {
	authSeq++;
	authInflight = null;
	await loadAuth();
}

async function saveToken(forge: Forge, token: string, host?: string): Promise<void> {
	await connectionsApi.saveToken(forge, token, host);
	forgetRemote(forge);
	await recheck();
}

async function clearToken(forge: Forge): Promise<ProviderAuth | null> {
	await connectionsApi.clearToken(forge);
	forgetRemote(forge);
	await recheck();

	return get().auth?.[forge] ?? null;
}

/** The repository waiting on Undo at this address, once its removal is called off; null when there is none or it already went out. */
function takeBack(url: string): Repo | null {
	const key = repoKey(url);
	const waiting = tracked.find((item) => hidden.has(item.id) && repoKey(item.url) === key);

	return waiting && hidden.get(waiting.id)?.() ? waiting : null;
}

async function addRepo(input: CreateRepoInput): Promise<Repo> {
	const waiting = takeBack(input.url);

	if (waiting) {
		restoreRepo(waiting);

		return waiting;
	}

	const repo = await connectionsApi.addRepo(input);

	repoSeq++;

	if (!tracked.some((item) => item.id === repo.id)) showRepos([...tracked, repo]);

	return repo;
}

function hideRepo(repo: Repo, cancel: () => boolean): void {
	hidden.set(repo.id, cancel);
	showRepos(tracked);
}

function restoreRepo(repo: Repo): void {
	hidden.delete(repo.id);
	showRepos(tracked);
}

async function removeRepo(repo: Repo): Promise<void> {
	try {
		await connectionsApi.removeRepo(repo.id);
		repoSeq++;
		tracked = tracked.filter((item) => item.id !== repo.id);
	} finally {
		hidden.delete(repo.id);
		showRepos(tracked);
	}
}

/** The tracked repositories by `repoKey`, to mark rows of the browser that are already tracked. */
export function trackedKeys(repos: Repo[] | null): Set<string> {
	return new Set((repos ?? []).map((repo) => repoKey(repo.url)));
}
