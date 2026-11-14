import type { Provider } from './repo';

/**
 * Recoder accounts. The person who sets the server up signs in with GitHub or
 * GitLab (device flow or a token); that account is the admin, and its sign-in
 * is also the forge connection Recoder reads pull requests with. Anyone else
 * who signs in with their own forge becomes a member, until the admin removes
 * them. A member's sign-in only proves who they are: it never changes the
 * server's forge connection.
 */

/** What an account may do: the admin also changes server configuration and members; a member uses reviews, chats and pull requests. */
export type AccountRole = 'admin' | 'member';

/** A forge a person can sign in with: every provider but a local repository. */
export type SignInForge = Exclude<Provider, 'local'>;

/** How a forge signs a person in: a redirect to the forge and back, or a code entered on the forge's device page. */
export type SignInMethod = 'redirect' | 'device';

/** One forge identity linked to an account. */
export interface LinkedForge {
	provider: SignInForge;
	/** GitLab's self-managed host; null for github.com and gitlab.com. */
	host: string | null;
	/** The forge's login, e.g. `octocat`. */
	login: string;
	/** The forge's display name, when it has one. */
	name: string | null;
	avatarUrl: string | null;
	linkedAt: string;
}

/** The signed-in person. */
export interface Account {
	id: string;
	role: AccountRole;
	/** From the first linked forge: its display name, else its login. */
	name: string;
	avatarUrl: string | null;
	forges: LinkedForge[];
	createdAt: string;
}

/**
 * One row of `GET /api/members`: the admin or a member. Anyone who signs in
 * with GitHub or GitLab becomes a member, so every row is a person who has
 * signed in. `key` names the row in `DELETE /api/members/:key` (URL-encode
 * it); it is stable and does not change when the person renames their forge
 * login. `login` is as the forge last spelled it.
 */
export interface Member {
	key: string;
	id: string;
	provider: SignInForge;
	host: string | null;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	role: AccountRole;
	joinedAt: string;
}

/**
 * `GET /api/auth/me`. `setup` is true while no account exists yet, so the
 * app opens the start screen instead of a sign-in. `forges` says how each
 * forge signs in: `redirect` when its OAuth client id and secret are set
 * (`RECODER_GITHUB_CLIENT_ID` and `RECODER_GITHUB_CLIENT_SECRET`, and the
 * GitLab pair), `device` with only the id, `null` with neither.
 */
export interface AuthState {
	account: Account | null;
	setup: boolean;
	forges: { provider: SignInForge; method: SignInMethod | null }[];
	/**
	 * Forge connections the server already has (a saved token or a signed-in
	 * CLI) that this browser may use without a sign-in. During setup: all of
	 * them, so an existing install can make its admin account from one with
	 * `POST /api/auth/adopt`. After setup, for a signed-out browser on the
	 * server's own machine (no proxy in between): only those whose user already
	 * has an account (the admin, or a member who has signed in before), and
	 * `POST /api/auth/adopt` then signs in to that account without changing
	 * the account or the connection. Empty when signed in, and over a proxy.
	 */
	connected: ConnectedForge[];
	/**
	 * During setup: true until this browser proves it may claim the server,
	 * by being on the server's own machine with no proxy in between, or by
	 * sending the one-time setup code the server prints when it starts
	 * (`POST /api/auth/setup`). While locked, `connected` is empty and the
	 * device, token and adopt routes answer 403 `setup-locked`. False once
	 * an account exists; signing back in with a connection is then allowed
	 * only on the server's own machine (adopt answers 403 `not-local`
	 * elsewhere), and the setup code does not open it.
	 */
	setupLocked: boolean;
}

/** `POST /api/auth/setup`: the setup code from the server's log; unlocks setup for this browser for a short while. */
export interface UnlockSetup {
	code: string;
}

/** A forge connection the server already has, named by the identity behind it. */
export interface ConnectedForge {
	provider: SignInForge;
	host: string | null;
	login: string;
}

/**
 * `POST /api/auth/adopt`: make the admin account from a connection in `AuthState.connected` during setup, or after
 * setup sign in to the account that connection belongs to; answers the account and sets the session cookie.
 */
export interface AdoptConnection {
	provider: SignInForge;
}

/** `POST /api/auth/device`: start a sign-in, or link another forge when signed in. */
export interface StartDeviceSignIn {
	provider: SignInForge;
	/** GitLab only: a self-managed host; omitted for gitlab.com. */
	host?: string;
}

/** What the person does on the forge: open `verificationUri` and enter `userCode`. */
export interface DeviceSignIn {
	attemptId: string;
	userCode: string;
	verificationUri: string;
	/** Seconds between polls the forge asks for. */
	interval: number;
	expiresAt: string;
}

/**
 * `GET /api/auth/device/:attemptId`. `signed-in` sets the session cookie and
 * carries the account; the others end the attempt except `pending`.
 */
export type DeviceSignInState =
	| { state: 'pending' }
	| { state: 'signed-in'; account: Account }
	| { state: 'expired' }
	| { state: 'denied' }
	| { state: 'failed'; reason: string };
