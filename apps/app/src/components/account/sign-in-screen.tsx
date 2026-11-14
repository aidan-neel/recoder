'use client';

import type { Account, AuthState, SignInForge } from '@recoder/shared';
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	ForgeMark
} from '@recoder/ui';
import type { ReactElement } from 'react';

import { useAccount } from '@/lib/account/account-store';
import { chooseTitle, deviceTitle } from '@/lib/account/device-copy';
import { useRedirectSignIn } from '@/lib/account/oauth-redirect';
import { signInStep } from '@/lib/account/sign-in-step';
import { hasNonTokenRow, signInRows } from '@/lib/account/sign-in-rows';
import { useAdoptConnection } from '@/lib/account/use-adopt-connection';
import { useDeviceSignIn } from '@/lib/account/use-device-sign-in';
import { useSignInError } from '@/lib/account/use-sign-in-error';
import { useSignInScreen } from '@/lib/account/use-sign-in-screen';
import type { AuthApi } from '@/lib/api/accounts';
import { FORGES } from '@/lib/connections/forges';

import { TokenModal } from '@/components/connections/token-modal';

import { DevicePanel } from './device-panel';
import { SetupCodeForm } from './setup-code-form';
import { SignInChoices } from './sign-in-choices';

const PROVIDERS: readonly SignInForge[] = ['github', 'gitlab'];

interface TokenMenuProps {
	onToken: (forge: SignInForge) => void;
	/** The button that opens the menu. */
	children: ReactElement;
}

/** Where a person can connect a forge by hand: a menu of the forges' token forms. */
function TokenMenu({ onToken, children }: TokenMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align="center">
				{FORGES.map((forge) => (
					<DropdownMenuItem key={forge.id} icon={<ForgeMark provider={forge.id} />} onSelect={() => onToken(forge.id)}>
						{forge.label} token
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

interface SignInScreenProps {
	api: AuthApi;
	auth: AuthState;
}

/**
 * The first screen when no one is signed in: one row per forge, each
 * "Continue as" a connection the server has, the forge's redirect or device
 * code, or its token form. Before any account exists it is the start of Recoder; once an
 * account exists it is a sign-in.
 */
export function SignInScreen({ api, auth }: SignInScreenProps) {
	const screen = useSignInScreen();

	const signedIn = (account: Account): void => {
		screen.finish();
		useAccount.getState().adopt(account);
	};

	const signIn = useDeviceSignIn(api, signedIn);
	const adoption = useAdoptConnection(api, signedIn);
	const redirect = useRedirectSignIn();
	const signInError = useSignInError();

	const { state } = signIn;
	const locked = signInStep(auth) === 'code';
	const rows = signInRows(PROVIDERS, auth);

	return (
		<main className="signin">
			<div className="signin-card">
				<h1 className="signin-title">
					{state.phase === 'idle' || locked ? chooseTitle(auth.setup) : deviceTitle(state)}
				</h1>
				{locked ? <SetupCodeForm api={api} /> : null}
				{!locked && state.phase === 'idle' ? (
					<SignInChoices
						rows={rows}
						adoption={adoption}
						start={signIn.start}
						redirect={redirect}
						signInError={signInError}
						onToken={screen.token.connect}
					/>
				) : null}
				{!locked && state.phase !== 'idle' ? <DevicePanel state={state} view={signIn} /> : null}
				{!locked && state.phase === 'idle' && hasNonTokenRow(rows) ? (
					<TokenMenu onToken={screen.token.connect}>
						<Button variant="ghost">Use a token instead</Button>
					</TokenMenu>
				) : null}
			</div>
			<TokenModal dialog={screen.token} />
		</main>
	);
}
