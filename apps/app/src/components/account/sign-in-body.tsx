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
import type { ReactElement, ReactNode } from 'react';

import { useAccount } from '@/lib/account/account-store';
import { useRedirectSignIn } from '@/lib/account/oauth-redirect';
import { hasNonTokenRow, signInRows } from '@/lib/account/sign-in-rows';
import { useAdoptConnection } from '@/lib/account/use-adopt-connection';
import { useDeviceSignIn, type DeviceSignInView } from '@/lib/account/use-device-sign-in';
import { useSignInError } from '@/lib/account/use-sign-in-error';
import { useSignInScreen } from '@/lib/account/use-sign-in-screen';
import type { AuthApi } from '@/lib/api/accounts';
import { FORGES } from '@/lib/connections/forges';

import { TokenModal } from '@/components/connections/token-modal';

import { DevicePanel } from './device-panel';
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

interface SignInBodyProps {
	api: AuthApi;
	auth: AuthState;
	/** Draws what sits above the choices, from where the device sign-in stands; nothing when omitted. */
	heading?: (signIn: DeviceSignInView) => ReactNode;
}

/**
 * The forge choices of a sign-in: one row per forge, each "Continue as" a connection the server has, the forge's
 * redirect or device code, or its token form, then the device code's panel while one runs. The sign-in screen and
 * the setup checklist's admin step both show it.
 */
export function SignInBody({ api, auth, heading }: SignInBodyProps) {
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
	const rows = signInRows(PROVIDERS, auth);

	return (
		<>
			{heading?.(signIn)}
			{state.phase === 'idle' ? (
				<SignInChoices
					rows={rows}
					adoption={adoption}
					start={signIn.start}
					redirect={redirect}
					signInError={signInError}
					onToken={screen.token.connect}
				/>
			) : (
				<DevicePanel state={state} view={signIn} />
			)}
			{state.phase === 'idle' && hasNonTokenRow(rows) ? (
				<TokenMenu onToken={screen.token.connect}>
					<Button variant="ghost">Use a token instead</Button>
				</TokenMenu>
			) : null}
			<TokenModal dialog={screen.token} />
		</>
	);
}
