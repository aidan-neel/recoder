'use client';

import type { AuthState } from '@recoder/shared';

import { chooseTitle, deviceTitle } from '@/lib/account/device-copy';
import type { AuthApi } from '@/lib/api/accounts';

import { SignInBody } from './sign-in-body';

interface SignInScreenProps {
	api: AuthApi;
	auth: AuthState;
}

/** The first screen when no one is signed in and an account exists: the forge choices under a title. */
export function SignInScreen({ api, auth }: SignInScreenProps) {
	return (
		<main className="signin">
			<div className="signin-card">
				<SignInBody
					api={api}
					auth={auth}
					heading={({ state }) => (
						<h1 className="signin-title">{state.phase === 'idle' ? chooseTitle(auth.setup) : deviceTitle(state)}</h1>
					)}
				/>
			</div>
		</main>
	);
}
