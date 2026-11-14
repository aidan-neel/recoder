'use client';

import { useRouter } from 'next/navigation';

import { pullsHref } from '../shell/routes';
import { useTokenDialog, type TokenDialog } from '../connections/use-token-dialog';
import { refreshForges, useAccount } from './account-store';

/** What the sign-in screen needs besides the forge buttons. */
export interface SignInScreenView {
	/** The token form: the server makes the account from the token, or signs a linked identity back in. */
	token: TokenDialog;
	/** Runs once the sign-in is done: checks the forges and lands on the pull request list. */
	finish: () => void;
}

/**
 * The sign-in screen's own actions. A saved token makes the account or signs
 * a linked identity back in, so the screen reads who is signed in again. A finished sign-in
 * lands on the pull request list with the forge connected, so the repository picker is ready.
 */
export function useSignInScreen(): SignInScreenView {
	const router = useRouter();

	const finish = (): void => {
		refreshForges();
		router.replace(pullsHref(''));
	};

	const token = useTokenDialog(() => {
		finish();
		void useAccount.getState().reload();
	});

	return { token, finish };
}
