'use client';

import type { AgentOAuthAttempt } from '@recoder/shared';
import { Button, CopyButton, Field, Input } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';
import type { FormEvent } from 'react';

import { SIGN_IN_FORM, type ProviderFlow } from '@/lib/settings/providers/use-provider-flow';

/** What to do on the provider's page: a device code to type, set large with its copy button, or the provider's own words. */
function Instructions({ attempt, device }: { attempt: AgentOAuthAttempt; device: string | null }) {
	if (device) {
		return (
			<div className="provider-device">
				<p className="provider-note">Enter this code on the sign-in page.</p>
				<div className="provider-device-code">
					<span className="provider-device-text">{device}</span>
					<CopyButton value={device} label="Copy code" iconOnly />
				</div>
			</div>
		);
	}

	return attempt.instructions ? <p className="provider-note">{attempt.instructions}</p> : null;
}

/** How the sign-in ends: the code the provider hands back, pasted here, or a wait for the browser to finish. */
function Finish({ flow, attempt }: { flow: ProviderFlow; attempt: AgentOAuthAttempt }) {
	if (attempt.mode === 'auto') return <p className="provider-waiting">Waiting for you to finish in the browser</p>;

	return (
		<Field label="Code from the provider" error={flow.error}>
			<Input
				autoComplete="off"
				spellCheck={false}
				autoFocus
				value={flow.code}
				readOnly={flow.sending}
				onChange={(event) => flow.setCode(event.target.value)}
			/>
		</Field>
	);
}

/**
 * A browser sign-in under way. The provider's page opened in a new tab (the
 * link opens it again if the browser blocked it); the dialog then waits for
 * the sign-in to land, or asks for the code the provider hands back.
 */
export function SignInView({ flow, attempt }: { flow: ProviderFlow; attempt: AgentOAuthAttempt }) {
	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		flow.submit();
	}

	return (
		<form id={SIGN_IN_FORM} aria-live="polite" className="provider-form" onSubmit={submit}>
			<Instructions attempt={attempt} device={flow.device} />
			<Button variant="outline" asChild className="provider-sign-in-link">
				<a href={attempt.url} target="_blank" rel="noopener noreferrer">
					Open sign-in page
					<ArrowUpRight aria-hidden />
				</a>
			</Button>
			<Finish flow={flow} attempt={attempt} />
		</form>
	);
}
