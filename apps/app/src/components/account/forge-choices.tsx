'use client';

import type { SignInForge, StartDeviceSignIn } from '@recoder/shared';
import { Button, Field, ForgeMark, Input } from '@recoder/ui';
import { useId, type FormEvent } from 'react';

import { useForgeChoices, type ForgeChoicesView } from '@/lib/account/use-forge-choices';
import { forgeLabel } from '@/lib/connections/forges';

interface ForgeChoicesProps {
	/** The forges to offer, in order. */
	providers: readonly SignInForge[];
	/** Which of them the server can sign in with. */
	available: ReadonlySet<SignInForge>;
	start: (input: StartDeviceSignIn) => void;
}

/** GitLab's quiet link and the host field it reveals. */
function HostField({ choices }: { choices: ForgeChoicesView }) {
	const fieldId = useId();

	return (
		<>
			<Button variant="ghost" size="sm" className="forge-host-toggle" onClick={choices.toggleHost}>
				{choices.hostOpen ? 'Use gitlab.com' : 'Use a self-managed GitLab'}
			</Button>
			{choices.hostOpen ? (
				<Field label="GitLab host" htmlFor={fieldId} error={choices.hostError ?? undefined}>
					<Input
						id={fieldId}
						value={choices.host}
						placeholder="gitlab.example.com"
						autoComplete="off"
						autoFocus
						spellCheck={false}
						onChange={(event) => choices.setHost(event.target.value)}
					/>
				</Field>
			) : null}
		</>
	);
}

interface ForgeChoiceProps {
	provider: SignInForge;
	choices: ForgeChoicesView;
	/** Starts the sign-in: the device code, or the redirect to the forge. */
	begin: (input: StartDeviceSignIn) => void;
	variant?: 'primary' | 'secondary';
	disabled?: boolean;
	/** The button spins: the page is on its way to the forge. */
	pending?: boolean;
}

/** One forge: its Continue button and, for GitLab, its host. */
export function ForgeChoice({ provider, choices, begin, variant = 'secondary', disabled, pending }: ForgeChoiceProps) {
	function submit(event: FormEvent): void {
		event.preventDefault();
		choices.choose(provider, begin);
	}

	return (
		<form className="forge-choice" noValidate onSubmit={submit}>
			<Button
				type="submit"
				variant={variant}
				className="forge-continue"
				status={pending ? 'pending' : 'idle'}
				disabled={disabled}
			>
				<span aria-hidden className="contents">
					<ForgeMark provider={provider} />
				</span>
				Continue with {forgeLabel(provider)}
			</Button>
			{provider === 'gitlab' ? <HostField choices={choices} /> : null}
		</form>
	);
}

/**
 * The forges a person can sign in with, each a Continue button. A forge the
 * server cannot sign in with is left out, and with none the list is empty.
 */
export function ForgeChoices({ providers, available, start }: ForgeChoicesProps) {
	const choices = useForgeChoices();
	const offered = providers.filter((provider) => available.has(provider));

	if (offered.length === 0) return null;

	return (
		<div className="forge-choices">
			{offered.map((provider) => (
				<ForgeChoice key={provider} provider={provider} choices={choices} begin={start} />
			))}
		</div>
	);
}
