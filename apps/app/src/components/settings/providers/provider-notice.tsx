'use client';

import { Button, CodeBlock, StatusNotice } from '@recoder/ui';
import { RotateCw } from 'lucide-react';

import { pickNotice } from '@/lib/settings/providers/pick-notice';
import { useCheckAgain } from '@/lib/settings/providers/use-check-again';
import type { ProviderSource } from '@/lib/settings/providers/use-provider-source';

/** Why there is no provider list: the server is down, the check failed, or the agent is not ready. */
type NoListSource = Exclude<ProviderSource, { state: 'loading' | 'ready' }>;

/**
 * Runs the agent check again. It spins while the check runs, then reads
 * "Checked" for a moment (the notice may look the same as before), or "Try
 * again" when the agent still cannot be reached.
 */
export function CheckAgain({ label }: { label: string }) {
	const check = useCheckAgain();

	return (
		<Button variant="outline" status={check.status} successLabel="Checked" onClick={check.run}>
			<RotateCw aria-hidden />
			{label}
		</Button>
	);
}

/**
 * What to run or set by hand, in the kit's code block with its copy button. It shows as plain text and wraps, since
 * an agent's hint can be a sentence ("pi, then type /login") and must never be cut.
 */
export function Command({ command }: { command: string }) {
	return <CodeBlock code={command} copy wrap className="provider-command" />;
}

/**
 * In the dialog, in place of the provider list: the same words centred in
 * the room the list would take, then the command and the way out.
 */
export function PickNotice({ source }: { source: NoListSource }) {
	const notice = pickNotice(source);
	const hasWayOut = notice.command !== null || notice.retryLabel !== null;

	return (
		<StatusNotice
			variant="section"
			className="provider-pick-notice"
			title={notice.lead}
			detail={notice.rest}
			actions={
				hasWayOut ? (
					<>
						{notice.command ? <Command command={notice.command} /> : null}
						{notice.retryLabel ? <CheckAgain label={notice.retryLabel} /> : null}
					</>
				) : null
			}
		/>
	);
}
