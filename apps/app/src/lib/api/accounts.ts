import type {
	Account,
	AdoptConnection,
	AuthState,
	DeviceSignIn,
	DeviceSignInState,
	StartDeviceSignIn,
	UnlockSetup
} from '@recoder/shared';

import { post, request, seg } from './http';

/** The account calls the screens make: who is signed in, the device sign-in, and signing out. */
export interface AuthApi {
	/** Who is signed in, whether this server has an account yet, and which forges can sign in. */
	me: () => Promise<AuthState>;
	/** Starts a sign-in on a forge, or links another forge when signed in. */
	startSignIn: (input: StartDeviceSignIn) => Promise<DeviceSignIn>;
	/** Where an attempt stands; the server sets the session cookie in the answer that says `signed-in`. */
	signInState: (attemptId: string, signal: AbortSignal) => Promise<DeviceSignInState>;
	/** Unlocks setup for this browser with the code the server prints in its log. */
	unlockSetup: (input: UnlockSetup) => Promise<void>;
	/** Makes the account from a connection the server already has (`AuthState.connected`) and signs in. */
	adopt: (input: AdoptConnection) => Promise<{ account: Account }>;
	signOut: () => Promise<void>;
}

/** The review server's accounts. */
export const accountsApi: AuthApi = {
	me: () => request<AuthState>('/api/auth/me'),
	startSignIn: (input) => post<DeviceSignIn>('/api/auth/device', input),
	signInState: (attemptId, signal) => request<DeviceSignInState>(`/api/auth/device/${seg(attemptId)}`, { signal }),
	unlockSetup: (input) => post<void>('/api/auth/setup', input),
	adopt: (input) => post<{ account: Account }>('/api/auth/adopt', input),
	signOut: () => post<void>('/api/auth/logout')
};
