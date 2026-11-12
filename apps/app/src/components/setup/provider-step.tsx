'use client';

import { Button } from '@recoder/ui';
import { useState } from 'react';

import { cliFix } from '@/lib/settings/providers/agent-cli';
import { useProviderStep } from '@/lib/setup/use-provider-step';

import { CheckAgain, Command } from '@/components/settings/providers/provider-notice';
import { VllmConnectModal } from '@/components/settings/vllm-connect';

import { SetupStep } from './setup-step';

interface ProviderStepProps {
	done: boolean;
	current: boolean;
	/** Opens the provider dialog. */
	onAdd: () => void;
}

/**
 * Step one: a model provider. Providers are added through the agent, so
 * while it is missing the step shows the command that installs it and a way
 * to check again. A vLLM server needs no agent, so it can be connected either way.
 */
export function ProviderStep({ done, current, onAdd }: ProviderStepProps) {
	const step = useProviderStep(done);
	const [connecting, setConnecting] = useState(false);
	const fix = !done && !step.ready && step.manager ? cliFix(step.manager) : null;

	return (
		<SetupStep
			name="Model provider"
			detail={step.description}
			done={done}
			current={current}
			below={
				fix ? (
					<div className="setup-command">
						<Command command={fix} />
					</div>
				) : null
			}
		>
			{!done && step.ready ? (
				<Button variant={current ? 'primary' : 'outline'} onClick={onAdd}>
					Add a provider
				</Button>
			) : null}
			{!done && !step.ready ? <CheckAgain label="Check again" /> : null}
			{!done ? (
				<Button variant={step.ready ? 'ghost' : 'outline'} onClick={() => setConnecting(true)}>
					Connect vLLM server
				</Button>
			) : null}
			<VllmConnectModal open={connecting} onOpenChange={setConnecting} />
		</SetupStep>
	);
}
