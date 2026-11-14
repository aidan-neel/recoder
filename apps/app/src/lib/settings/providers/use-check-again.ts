'use client';

import type { ButtonStatus } from '@recoder/ui';

import { useAction } from '../../shell/use-action';
import { useSettings } from '../settings-store';

/** How a failed agent check reads, on Settings → Providers and in the provider modal. */
export const CHECK_FAILED = 'Couldn’t check the agents';

/** Runs the agent check again and reloads the providers; rejects when the agent or the server still can't be reached. */
async function checkAgain(): Promise<void> {
	await useSettings.getState().load(true);

	const { agentError, status } = useSettings.getState();

	if (agentError || status === 'offline') throw new Error(agentError ?? 'offline');
}

/** Everything the "Check again" action shows and does. */
export interface CheckAgainView {
	status: ButtonStatus;
	run: () => void;
}

/**
 * Runs the agent check again (installed, version, signed in) and reloads the
 * providers. It spins while the check runs, then reads "Checked" for a moment
 * (the rows may look the same as before), or "Try again" when the agent still
 * can't be reached.
 */
export function useCheckAgain(): CheckAgainView {
	const check = useAction({ showSuccess: true });

	return { status: check.status, run: () => check.run(checkAgain) };
}
