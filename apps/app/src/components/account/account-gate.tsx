'use client';

import { useEffect, type ReactNode } from 'react';

import { gateOf, useAccount } from '@/lib/account/account-store';
import type { AuthApi } from '@/lib/api/accounts';

import { SignInScreen } from './sign-in-screen';

interface AccountGateProps {
	api: AuthApi;
	children: ReactNode;
}

/**
 * Decides what the live app paints first. Nothing paints until the server has
 * said who is signed in, so the shell never shows and then gives way to
 * sign-in; a refused request (`401 signed-out`) later swaps the same way.
 */
export function AccountGate({ api, children }: AccountGateProps) {
	const status = useAccount((state) => state.status);
	const auth = useAccount((state) => state.auth);
	const gate = gateOf({ status, auth });

	useEffect(() => {
		void useAccount.getState().ensure(api);
	}, [api]);

	if (gate === 'sign-in' && auth) return <SignInScreen api={api} auth={auth} />;
	if (gate === 'open') return children;

	return null;
}
