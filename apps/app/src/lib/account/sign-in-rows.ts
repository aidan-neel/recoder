import type { AuthState, ConnectedForge, SignInForge } from '@recoder/shared';

/** One forge on the sign-in screen, and what pressing its button does. */
export type SignInRow =
	| { provider: SignInForge; mode: 'adopt'; connection: ConnectedForge }
	| { provider: SignInForge; mode: 'redirect' }
	| { provider: SignInForge; mode: 'device' }
	| { provider: SignInForge; mode: 'token' };

/**
 * One row per forge, always: the connection the server already has, else the
 * forge's redirect or device sign-in as the server offers it, else its token form.
 */
export function signInRows(providers: readonly SignInForge[], auth: AuthState): SignInRow[] {
	return providers.map((provider): SignInRow => {
		const connection = auth.connected.find((found) => found.provider === provider);

		if (connection) return { provider, mode: 'adopt', connection };

		const method = auth.forges.find((forge) => forge.provider === provider)?.method;

		return method ? { provider, mode: method } : { provider, mode: 'token' };
	});
}

/** The token menu is a way around the rows, so it shows only when a row does not already lead to a token. */
export function hasNonTokenRow(rows: readonly SignInRow[]): boolean {
	return rows.some((row) => row.mode !== 'token');
}
