'use client';

import type { AgentSetupJob } from '@recoder/shared';
import { useEffect, useRef, useState } from 'react';

import { agentSetupApi, type AgentSetupStep } from '../../api/agent-setup';
import { failureText } from '../../api/http';
import { useSettings } from '../settings-store';
import { followSetupJob } from './follow-setup-job';

/** Everything an agent's install or sign-in shows and does. */
export interface AgentSetup {
	/** The latest run, or null before the first. */
	job: AgentSetupJob | null;
	/** A step is starting or running. */
	running: boolean;
	/** Why the last step failed: the request's or the job's own reason; null otherwise. */
	error: string | null;
	start: (step: AgentSetupStep) => void;
	cancel: () => void;
	/** Sends the code the sign-in waits for; rejects when the server refuses it. */
	sendInput: (text: string) => Promise<void>;
}

/**
 * Runs one agent's install or sign-in on the server and follows it. Polling
 * stops when the job finishes and when the component unmounts; leaving the page
 * does not cancel the job.
 */
export function useAgentSetup(agentId: string): AgentSetup {
	const [job, setJob] = useState<AgentSetupJob | null>(null);
	const [starting, setStarting] = useState(false);
	const [requestError, setRequestError] = useState<string | null>(null);
	const polling = useRef<AbortController | null>(null);

	useEffect(() => () => polling.current?.abort(), []);

	async function run(step: AgentSetupStep, signal: AbortSignal): Promise<void> {
		const started = await agentSetupApi.start(agentId, step, signal);

		setJob(started);
		setStarting(false);

		await followSetupJob({
			job: started,
			signal,
			onJob: setJob,
			refresh: () => useSettings.getState().load(true)
		});
	}

	const running = starting || job?.status === 'running';

	function start(step: AgentSetupStep): void {
		if (running) return;

		polling.current?.abort();

		const controller = new AbortController();

		polling.current = controller;
		setJob(null);
		setRequestError(null);
		setStarting(true);

		run(step, controller.signal)
			.catch((failure: unknown) => {
				if (!controller.signal.aborted) setRequestError(failureText(failure));
			})
			.finally(() => {
				if (!controller.signal.aborted) setStarting(false);
			});
	}

	function cancel(): void {
		if (!job) return;

		agentSetupApi.cancel(job.id).catch((failure: unknown) => setRequestError(failureText(failure)));
	}

	async function sendInput(text: string): Promise<void> {
		if (!job) return;

		setJob(await agentSetupApi.input(job.id, text));
	}

	return {
		job,
		running,
		error: requestError ?? (job?.status === 'failed' ? (job.error ?? 'It failed.') : null),
		start,
		cancel,
		sendInput
	};
}
