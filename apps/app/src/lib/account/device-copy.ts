import { forgeLabel } from '../connections/forges';
import type { ActiveSignIn } from './use-device-sign-in';

/** The title of a device sign-in's screen for the forge it is on. */
export function deviceTitle(state: ActiveSignIn): string {
	const forge = forgeLabel(state.input.provider);

	switch (state.phase) {
		case 'starting':
		case 'pending':
			return `Enter the code on ${forge}`;
		case 'signed-in':
			return `Signed in as ${state.account.name}`;
		case 'expired':
			return 'The code expired';
		case 'denied':
			return `${forge} turned the sign-in down`;
		case 'failed':
			return 'The sign-in failed';
	}
}

/** The title of the screen that offers the forges, in first run and once an account exists. */
export function chooseTitle(setup: boolean): string {
	return setup ? 'Welcome to Recoder' : 'Sign in to Recoder';
}
