import type { AuthState } from '@recoder/shared';

/** What the sign-in screen asks first: the setup code while setup is locked, else which forge to continue with. */
export type SignInStep = 'code' | 'choose';

/** The step the server's state calls for. A locked setup has no connections to offer, so nothing else shows before the code. */
export function signInStep(auth: Pick<AuthState, 'setup' | 'setupLocked'>): SignInStep {
	return auth.setup && auth.setupLocked ? 'code' : 'choose';
}
