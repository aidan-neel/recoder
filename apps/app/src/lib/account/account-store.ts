import type { Account, AuthState } from '@recoder/shared';
import { create } from 'zustand';

import type { AuthApi } from '../api/accounts';
import { onSessionRefused } from '../api/session-refused';
import { useConnections } from '../connections/connections-store';

/**
 * `loading`: the first answer has not come. `ready`: the server answered.
 * `unavailable`: it did not, so the app opens and its own screens report the
 * server as unreachable. A server older than accounts lands here too: it
 * answers CORS with `*`, which a request with credentials cannot use.
 */
type AccountStatus = 'loading' | 'ready' | 'unavailable';

/** What the app shows in place of its pages. */
export type AccountGate = 'checking' | 'sign-in' | 'open';

interface AccountStore {
	status: AccountStatus;
	auth: AuthState | null;
	/** Loads who is signed in from `api`, once per client; the same client again changes nothing. */
	ensure: (api: AuthApi) => Promise<void>;
	/** Asks the server again who is signed in. The screen on show stays until the answer lands. */
	reload: () => Promise<void>;
	/** Takes the account a sign-in returned. */
	adopt: (account: Account) => void;
	/** Ends the session on the server, then reads the state that leaves. */
	signOut: () => Promise<void>;
}

export const useAccount = create<AccountStore>(() => ({
	status: 'loading',
	auth: null,
	ensure,
	reload,
	adopt,
	signOut
}));

const get = useAccount.getState;
const set = useAccount.setState;

/** The client the state was loaded from, and the load in flight. */
let source: AuthApi | null = null;
let inflight: Promise<void> | null = null;

/** Which page the account state calls for. */
export function gateOf({ status, auth }: Pick<AccountStore, 'status' | 'auth'>): AccountGate {
	if (status === 'loading') return 'checking';
	if (status === 'unavailable' || !auth || auth.account) return 'open';

	return 'sign-in';
}

/** A failed read after a good one keeps what is on screen; before one, the app opens and its own screens report the failure. */
function loadFailed(): void {
	if (!get().auth) set({ status: 'unavailable' });
}

/** Reads who is signed in from `api`, one read at a time. */
function load(api: AuthApi): Promise<void> {
	if (inflight) return inflight;

	const read: Promise<void> = api
		.me()
		.then((auth) => set({ auth, status: 'ready' }), loadFailed)
		.finally(() => {
			if (inflight === read) inflight = null;
		});

	inflight = read;

	return read;
}

function ensure(api: AuthApi): Promise<void> {
	if (source === api) return inflight ?? Promise.resolve();

	source = api;
	inflight = null;
	set({ status: 'loading', auth: null });

	return load(api);
}

function reload(): Promise<void> {
	return source ? load(source) : Promise.resolve();
}

function adopt(account: Account): void {
	const { auth } = get();

	set({ auth: { forges: [], ...auth, account, setup: false, connected: [], setupLocked: false }, status: 'ready' });
}

/** Checks the forges and the repositories again: a sign-in on a forge is also its connection. */
export function refreshForges(): void {
	void useConnections.getState().loadAuth();
	void useConnections.getState().loadRepos();
}

async function signOut(): Promise<void> {
	await source?.signOut();
	await reload();
}

onSessionRefused(() => void reload());
