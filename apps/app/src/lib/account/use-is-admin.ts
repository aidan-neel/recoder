'use client';

import type { AuthState } from '@recoder/shared';

import { useAccount } from './account-store';

/**
 * Whether the person may change the server's configuration and its members.
 * Only a signed-in member may not: a server with no account has no roles, so
 * its screens stay open.
 */
export function isAdmin(auth: Pick<AuthState, 'account'> | null): boolean {
	return auth?.account?.role !== 'member';
}

/** `isAdmin` for the person signed in now; the one place a screen asks. */
export function useIsAdmin(): boolean {
	return useAccount((state) => isAdmin(state.auth));
}
