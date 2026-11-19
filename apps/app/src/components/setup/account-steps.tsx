'use client';

import type { SetupStep as Step } from '@recoder/shared';
import { Button, Field, Input } from '@recoder/ui';
import { useState, type FormEvent } from 'react';

import type { AuthApi } from '@/lib/api/accounts';
import { useAddressStep } from '@/lib/setup/use-address-step';

import { SetupCodeForm } from '@/components/account/setup-code-form';
import { SignInBody } from '@/components/account/sign-in-body';

import type { SetupAccount } from './checklist';
import { SetupStep } from './setup-step';

interface StepProps {
	step: Step;
	current: boolean;
}

/** Step one: the setup code the server printed, so only someone who can read its log claims it. */
export function ClaimStep({ step, current, api }: StepProps & { api?: AuthApi }) {
	return (
		<SetupStep
			name="Claim this server"
			step={step}
			current={current}
			code
			hint="The setup code from the server’s log"
			body={
				api ? (
					<>
						<p className="setup-text">Enter the setup code the server printed when it started.</p>
						<SetupCodeForm api={api} />
					</>
				) : null
			}
		/>
	);
}

/** Step two: the address people reach Recoder at, with HTTPS, from Recoder's own certificate or the person's proxy. */
export function AddressStep({ step, current }: StepProps) {
	const [changing, setChanging] = useState(false);
	const view = useAddressStep(current || changing);
	const proxy = view.mode === 'proxy';

	function submit(event: FormEvent): void {
		event.preventDefault();
		view.submit();
	}

	return (
		<SetupStep
			name="Address and HTTPS"
			step={step}
			current={current}
			code
			hint="A domain for this server, with a certificate"
			open={changing}
			body={
				view.continueAt ? (
					<div className="setup-actions">
						<Button variant="primary" onClick={() => window.location.assign(view.continueAt ?? '')}>
							Continue at {new URL(view.continueAt).host}
						</Button>
					</div>
				) : (
					<form className="setup-form" noValidate onSubmit={submit}>
						<p className="setup-text">
							{proxy
								? 'Your proxy serves HTTPS and passes requests on to Recoder.'
								: 'Point a domain’s DNS at this server, and Recoder gets an HTTPS certificate for it.'}
						</p>
						<Field
							label={proxy ? 'Public address' : 'Domain'}
							hint={view.issuing ? `Requesting a certificate for ${view.issuing}…` : undefined}
							error={view.error ?? undefined}
						>
							<Input
								value={view.value}
								placeholder={proxy ? 'https://recoder.example.com' : 'recoder.example.com'}
								autoComplete="off"
								spellCheck={false}
								inputMode="url"
								readOnly={view.status === 'pending'}
								onChange={(event) => view.setValue(event.target.value)}
							/>
						</Field>
						<div className="setup-actions">
							<Button type="submit" variant="primary" status={view.status} disabled={!view.value.trim()}>
								{proxy ? 'Save' : 'Get a certificate'}
							</Button>
							<Button variant="ghost" onClick={() => view.setMode(proxy ? 'domain' : 'proxy')}>
								{proxy ? 'Get a certificate instead' : 'I use my own proxy'}
							</Button>
							{changing ? (
								<Button variant="ghost" onClick={() => setChanging(false)}>
									Cancel
								</Button>
							) : null}
						</div>
					</form>
				)
			}
		>
			{step.done && !changing ? (
				<Button variant="ghost" onClick={() => setChanging(true)}>
					Change
				</Button>
			) : null}
		</SetupStep>
	);
}

/** Step three: the admin account, made by the first sign-in with a forge. */
export function AdminStep({ step, current, account }: StepProps & { account?: SetupAccount }) {
	return (
		<SetupStep
			name="Admin account"
			step={step}
			current={current}
			hint="Sign in with GitHub or GitLab"
			body={
				account ? (
					<>
						<p className="setup-text">
							Sign in with the forge your team uses. This account becomes the admin, and Recoder reads pull requests
							with it.
						</p>
						<div className="setup-signin">
							<SignInBody api={account.api} auth={account.auth} />
						</div>
					</>
				) : null
			}
		/>
	);
}
