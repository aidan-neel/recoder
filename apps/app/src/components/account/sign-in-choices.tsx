'use client';

import type { ConnectedForge, SignInForge, StartDeviceSignIn } from '@recoder/shared';
import { Button, ForgeMark } from '@recoder/ui';

import type { SignInRow } from '@/lib/account/sign-in-rows';
import type { AdoptView } from '@/lib/account/use-adopt-connection';
import type { RedirectSignInView } from '@/lib/account/oauth-redirect';
import { useForgeChoices } from '@/lib/account/use-forge-choices';
import { forgeLabel } from '@/lib/connections/forges';

import { ForgeChoice } from './forge-choices';

/** The name a connection is offered under: its login, and the host of a self-managed GitLab. */
function connectionName(connection: ConnectedForge): string {
	return connection.host ? `@${connection.login} on ${connection.host}` : `@${connection.login}`;
}

interface SignInChoicesProps {
	rows: readonly SignInRow[];
	adoption: AdoptView;
	start: (input: StartDeviceSignIn) => void;
	redirect: RedirectSignInView;
	/** Why the last redirect sign-in ended without a session, from the address; null otherwise. */
	signInError: string | null;
	onToken: (forge: SignInForge) => void;
}

/**
 * The forge rows, each one button. The first leads; the rest are secondary,
 * so the screen keeps one primary button. While a connection is being
 * adopted, or the page is leaving for a forge, the other rows wait.
 */
export function SignInChoices({ rows, adoption, start, redirect, signInError, onToken }: SignInChoicesProps) {
	const choices = useForgeChoices();
	const adopting = adoption.status === 'pending' || adoption.status === 'success';
	const reason = adoption.reason ?? signInError;

	return (
		<div className="forge-choices">
			{rows.map((row, index) => {
				const variant = index === 0 ? 'primary' : 'secondary';

				if (row.mode === 'device' || row.mode === 'redirect') {
					return (
						<ForgeChoice
							key={row.provider}
							provider={row.provider}
							choices={choices}
							begin={row.mode === 'redirect' ? redirect.begin : start}
							variant={variant}
							disabled={adopting || redirect.pending !== null}
							pending={redirect.pending === row.provider}
						/>
					);
				}

				const mine = row.mode === 'adopt' && adoption.target === row.connection;

				return (
					<Button
						key={row.provider}
						variant={variant}
						className="forge-continue"
						status={mine ? adoption.status : 'idle'}
						disabled={adopting && !mine}
						onClick={() => (row.mode === 'adopt' ? adoption.adopt(row.connection) : onToken(row.provider))}
					>
						<span aria-hidden className="contents">
							<ForgeMark provider={row.provider} />
						</span>
						{row.mode === 'adopt'
							? `Continue as ${connectionName(row.connection)}`
							: `Continue with ${forgeLabel(row.provider)}`}
					</Button>
				);
			})}
			{reason ? (
				<p className="device-reason" role="alert">
					{reason}
				</p>
			) : null}
		</div>
	);
}
