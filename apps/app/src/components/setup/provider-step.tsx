'use client';

import type { SetupStep as Step } from '@recoder/shared';
import { Button } from '@recoder/ui';
import { useState } from 'react';

import { cliFix } from '@/lib/settings/providers/agent-cli';
import { recheckSetup } from '@/lib/setup/setup-gate';
import { useProviderStep } from '@/lib/setup/use-provider-step';

import { CheckAgain, Command } from '@/components/settings/providers/provider-notice';
import { ProviderModal } from '@/components/settings/providers/provider-modal';
import { VllmConnectModal } from '@/components/settings/vllm-connect';

import { SetupStep } from './setup-step';

/** The provider step's dialogs: a provider through the agent, or a vLLM server, which needs no agent. */
type ProviderDialog = 'provider' | 'vllm';

/**
 * Step four: a model provider. Providers are added through the agent, so while it is missing the step shows the
 * command that installs it and a way to check again. A vLLM server needs no agent, so it can be connected either way.
 */
export function ProviderStep({ step, current }: { step: Step; current: boolean }) {
	const view = useProviderStep(step.done);
	const [dialog, setDialog] = useState<ProviderDialog | null>(null);
	const fix = !view.ready && view.manager ? cliFix(view.manager) : null;

	function openChange(open: boolean): void {
		if (open) return;

		setDialog(null);
		recheckSetup();
	}

	return (
		<SetupStep
			name="Model provider"
			step={step}
			current={current}
			hint="xAI, OpenAI, OpenRouter or your own endpoint"
			body={
				<>
					{view.description ? <p className="setup-text">{view.description}</p> : null}
					{fix ? <Command command={fix} /> : null}
					<div className="setup-actions">
						{view.ready ? (
							<Button variant="primary" onClick={() => setDialog('provider')}>
								Add a provider
							</Button>
						) : (
							<CheckAgain label="Check again" />
						)}
						<Button variant={view.ready ? 'ghost' : 'outline'} onClick={() => setDialog('vllm')}>
							Connect vLLM server
						</Button>
					</div>
					<ProviderModal open={dialog === 'provider'} providerId={null} onOpenChange={openChange} />
					<VllmConnectModal open={dialog === 'vllm'} onOpenChange={openChange} />
				</>
			}
		/>
	);
}
