'use client';

import type { Account, AccountRole, AuthState, LinkedForge, SignInForge } from '@recoder/shared';
import { useCallback, useEffect, useState } from 'react';

import { useApi } from '../api/client';
import { failureText } from '../api/http';
import { forgeLabel } from '../connections/forges';
import { errorToast, undoToast } from '../shell/notify';
import { refreshForges, useAccount } from './account-store';
import { useDeviceSignIn, type DeviceSignInView } from './use-device-sign-in';

/** The forge a link dialog is for, and where its sign-in stands. */
export interface LinkForgeView {
	/** The forge being linked. It keeps its forge while the dialog closes. */
	provider: SignInForge;
	open: boolean;
	signIn: DeviceSignInView;
	/** Opens the dialog; GitHub has nothing to ask first, so its sign-in starts at once. */
	begin: (provider: SignInForge) => void;
	close: () => void;
}

/** The forge that gets its dialog: GitHub unless a link was begun on another. */
const FIRST_FORGE: SignInForge = 'github';

/** The forges that can sign in and are not linked yet, in the server's order. */
function linkableForges(forges: AuthState['forges'], linked: LinkedForge[]): SignInForge[] {
	return forges
		.filter((forge) => forge.method !== null && !linked.some((item) => item.provider === forge.provider))
		.map((forge) => forge.provider);
}

function useLinkForge(): LinkForgeView {
	const { auth, base } = useApi();
	const [provider, setProvider] = useState<SignInForge>(FIRST_FORGE);
	const [open, setOpen] = useState(false);

	const linked = useCallback(
		(account: Account) => {
			useAccount.getState().adopt(account);

			if (base === '') refreshForges();

			setOpen(false);
			undoToast(`${forgeLabel(provider)} linked`);
		},
		[provider, base]
	);

	const signIn = useDeviceSignIn(auth, linked);
	const { start, reset } = signIn;

	return {
		provider,
		open,
		signIn,
		begin: (forge) => {
			reset();
			setProvider(forge);
			setOpen(true);

			if (forge === 'github') start({ provider: forge });
		},
		close: () => {
			setOpen(false);
			reset();
		}
	};
}

/** The signed-in account as the menu and Settings show it. */
export interface AccountView {
	name: string;
	avatarUrl: string | null;
	/** What the account may do; null without an account. */
	role: AccountRole | null;
	/** The forges the account signs in with. */
	forges: LinkedForge[];
	/** The forges this server can sign in with that the account has not linked. */
	linkable: SignInForge[];
	/** The sample has no session to end. */
	canSignOut: boolean;
	signOut: () => void;
}

/**
 * Who is signed in. Without an account (a server that has none, or a person
 * who went on with a token) the name is `fallbackName`.
 */
export function useAccountView(fallbackName: string): AccountView {
	const { auth, base } = useApi();
	const state = useAccount((store) => store.auth);
	const account = state?.account ?? null;

	useEffect(() => {
		void useAccount.getState().ensure(auth);
	}, [auth]);

	function signOut(): void {
		useAccount
			.getState()
			.signOut()
			.catch((error: unknown) => errorToast('Couldn’t sign out', failureText(error)));
	}

	return {
		name: account?.name ?? fallbackName,
		avatarUrl: account?.avatarUrl ?? null,
		role: account?.role ?? null,
		forges: account?.forges ?? [],
		linkable: account && state ? linkableForges(state.forges, account.forges) : [],
		canSignOut: account !== null && base === '',
		signOut
	};
}

/** The account view and the dialog that links another forge to it. */
export type AccountMenuView = AccountView & { link: LinkForgeView };

/** What the account menu shows and does. */
export function useAccountMenu(fallbackName: string): AccountMenuView {
	return { ...useAccountView(fallbackName), link: useLinkForge() };
}
