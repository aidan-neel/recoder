import type { AgentSetupJob } from '@recoder/shared';

import { del, post, request, seg } from './http';

/** The two steps Recoder can run for an agent CLI. */
export type AgentSetupStep = AgentSetupJob['step'];

/** Installing and signing in agent CLIs on the machine Recoder runs on. Admin only. */
export const agentSetupApi = {
	/** Starts the install or the sign-in; poll `job` until it leaves `running`. */
	start: (agent: string, step: AgentSetupStep, signal?: AbortSignal) =>
		post<{ job: AgentSetupJob }>(`/api/agent/${seg(agent)}/${step}`, {}, { signal }).then((body) => body.job),
	job: (job: string, signal?: AbortSignal) => request<AgentSetupJob>(`/api/agent/jobs/${seg(job)}`, { signal }),

	/** Sends the code a sign-in waits for. */
	input: (job: string, text: string) => post<AgentSetupJob>(`/api/agent/jobs/${seg(job)}/input`, { text }),
	cancel: (job: string) => del<{ ok: boolean }>(`/api/agent/jobs/${seg(job)}`)
};
