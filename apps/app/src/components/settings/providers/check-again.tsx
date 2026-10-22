'use client';

import { Button, type ButtonVariant } from '@recoder/ui';
import { RotateCw } from 'lucide-react';

import { useSettings } from '@/lib/settings/settings-store';
import { useAction } from '@/lib/shell/use-action';

/** How a failed agent check reads, on the Agent CLIs card and in the provider modal. */
export const CHECK_FAILED = 'Couldn’t check the agents';

interface CheckAgainProps {
	label?: string;
	variant?: ButtonVariant;
}

/** Runs the agent check again and reloads the providers; rejects when the agent or the server still can't be reached. */
async function checkAgain(): Promise<void> {
	await useSettings.getState().load(true);

	const { agentError, status } = useSettings.getState();

	if (agentError || status === 'offline') throw new Error(agentError ?? 'offline');
}

/**
 * Runs the agent check again (installed, version, signed in) and reloads the
 * providers. It spins while the check runs, then reads "Checked" for a moment
 * (the rows may look the same as before), or "Try again" when the agent still
 * can't be reached.
 */
export function CheckAgain({ label = 'Check again', variant = 'ghost' }: CheckAgainProps) {
	const check = useAction({ showSuccess: true });

	return (
		<Button variant={variant} status={check.status} successLabel="Checked" onClick={() => check.run(checkAgain)}>
			<RotateCw aria-hidden />
			{label}
		</Button>
	);
}
