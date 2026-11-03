import type { VllmServer } from '@recoder/shared';

import { del, post, request, seg } from './http';

interface Servers {
	servers: VllmServer[];
}

/** The vLLM servers Recoder keeps its model lists in step with. The key is sent once and never comes back in full. */
export const vllmApi = {
	list: () => request<Servers>('/api/settings/vllm'),

	/** Checks the address by listing its models, then saves it. The address may omit `/v1`. `connected` is the new server's id. */
	connect: (baseUrl: string, apiKey: string) =>
		post<Servers & { connected: string }>('/api/settings/vllm', { baseUrl, ...(apiKey ? { apiKey } : {}) }),

	/** Syncs every server with what it serves. Without `force`, a server synced a moment ago is left alone. */
	refresh: (force: boolean) => post<Servers>('/api/settings/vllm/refresh', { force }),

	disconnect: (id: string) => del<Servers>(`/api/settings/vllm/${seg(id)}`)
};
