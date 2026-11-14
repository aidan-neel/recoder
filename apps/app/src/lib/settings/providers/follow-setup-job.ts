import type { AgentSetupJob } from '@recoder/shared';

import { agentSetupApi } from '../../api/agent-setup';
import { waitFor } from '../../shell/wait-for';

/** How often a running install or sign-in is checked on. */
const SETUP_POLL_MS = 1000;

interface FollowOptions {
	/** The job as it started. */
	job: AgentSetupJob;
	/** Stops the polling, including the request in flight. */
	signal: AbortSignal;
	/** Every newer state of the job. */
	onJob: (job: AgentSetupJob) => void;
	/** Runs once when the job is done, so the agent's status reloads. */
	refresh: () => Promise<void>;
	/** Pauses between polls; tests pass a stub. */
	wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Polls the job about every second until it leaves `running`, handing each state
 * to `onJob`, and refreshes the agent's status when it finishes done. Rejects
 * when a poll fails or the signal aborts.
 */
export async function followSetupJob({ job, signal, onJob, refresh, wait = waitFor }: FollowOptions): Promise<void> {
	let current = job;

	while (current.status === 'running') {
		await wait(SETUP_POLL_MS, signal);

		current = await agentSetupApi.job(current.id, signal);
		onJob(current);
	}

	if (current.status === 'done') await refresh();
}
