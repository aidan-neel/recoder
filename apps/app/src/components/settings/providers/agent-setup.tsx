'use client';

import type { AgentStatus } from '@recoder/shared';
import { Button } from '@recoder/ui';
import { ArrowUpRightIcon } from '@phosphor-icons/react';

import type { AgentSetupStep } from '@/lib/api/agent-setup';
import { cliState } from '@/lib/settings/providers/agent-cli';
import { tailLines } from '@/lib/settings/providers/tail-lines';
import { useAgentSetup, type AgentSetup as AgentSetupState } from '@/lib/settings/providers/use-agent-setup';

import { Command } from './provider-notice';
import { SetupCodeForm } from './setup-code-form';
import { SetupOutput } from './setup-output';

/** What each step offers: its button, the command to run by hand, and whether Recoder can run it. */
interface StepPlan {
	step: AgentSetupStep;
	label: string;
	command: string | null;
	canRun: boolean;
}

/** The step the agent needs, or null when it is installed and signed in (or broken, which Check again handles). */
function planFor(agent: AgentStatus): StepPlan | null {
	const state = cliState(agent);

	if (state === 'missing') {
		return { step: 'install', label: 'Install', command: agent.install, canRun: agent.setup.install };
	}

	if (state === 'signed-out') {
		return { step: 'sign-in', label: 'Sign in', command: agent.login, canRun: agent.setup.signIn };
	}

	return null;
}

/**
 * The step that fixes an agent CLI: Install while it is missing, Sign in while
 * it is signed out. Recoder runs the step when the server can, and shows its
 * output as it goes; otherwise the command to run in a terminal.
 */
export function AgentSetup({ agent }: { agent: AgentStatus }) {
	const plan = planFor(agent);

	if (!plan) return null;

	return <SetupStep key={plan.step} agentId={agent.id} plan={plan} />;
}

/** One step, from its button through the running job to its failure. */
function SetupStep({ agentId, plan }: { agentId: string; plan: StepPlan }) {
	const setup = useAgentSetup(agentId);
	const live = setup.job?.status === 'running' ? setup.job : null;

	if (!plan.canRun) return plan.command ? <Command command={plan.command} /> : null;

	return (
		<div className="agent-setup">
			<div className="agent-setup-actions">
				<Button variant="primary" status={setup.running ? 'pending' : 'idle'} onClick={() => setup.start(plan.step)}>
					{setup.error ? 'Try again' : plan.label}
				</Button>
				{live ? (
					<Button variant="ghost" onClick={setup.cancel}>
						Cancel
					</Button>
				) : null}
				{live?.url ? <SignInLink url={live.url} /> : null}
			</div>
			{setup.error ? <p className="row-problem">{setup.error}</p> : null}
			<SetupJobDetail setup={setup} />
		</div>
	);
}

/**
 * What a running or finished setup job adds under its controls: the code prompt
 * while the CLI waits on stdin, and the tailed terminal output once any arrives.
 * Renders nothing while empty, so starting a job never shifts the layout early.
 */
export function SetupJobDetail({ setup, className }: { setup: AgentSetupState; className?: string }) {
	const live = setup.job?.status === 'running' ? setup.job : null;
	const hasOutput = Boolean(setup.job && tailLines(setup.job.output));

	if (!live?.needsInput && !hasOutput) return null;

	return (
		<div className={className ?? 'agent-setup'}>
			{live?.needsInput ? <SetupCodeForm onSubmit={setup.sendInput} /> : null}
			{setup.job ? <SetupOutput output={setup.job.output} /> : null}
		</div>
	);
}

/** Opens the sign-in page the CLI printed in a new tab. */
export function SignInLink({ url }: { url: string }) {
	return (
		<Button variant="outline" asChild>
			<a href={url} target="_blank" rel="noopener noreferrer">
				Open sign-in page
				<ArrowUpRightIcon aria-hidden />
			</a>
		</Button>
	);
}
