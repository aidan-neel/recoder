import type { VllmServer } from '@recoder/shared';
import { create } from 'zustand';

import { vllmApi } from '../api/vllm';
import { useSettings } from './settings-store';

interface VllmStore {
	servers: VllmServer[];
	/** The saved servers have been read once; before that Settings shows a skeleton. */
	loaded: boolean;
	/** Reads the saved servers, then syncs them (the server skips one synced moments ago). Never rejects: a server that is down leaves the list as it was. */
	open: () => Promise<void>;
	/** Syncs now, whatever the last sync was. Rejects when a server still can't be reached. */
	sync: () => Promise<void>;
	/** Saves a server after checking it and returns it. Rejects with the server's reason. */
	connect: (baseUrl: string, apiKey: string) => Promise<VllmServer>;
	disconnect: (id: string) => Promise<void>;
}

/** Takes the server's answer, and the pickers' model list with it, since a sync can add or drop models. */
function take(servers: VllmServer[]): VllmServer[] {
	useVllm.setState({ servers, loaded: true });
	void useSettings.getState().reloadModels();

	return servers;
}

/** The vLLM servers on the Agent page. The models they serve reach the pickers through the settings store. */
export const useVllm = create<VllmStore>(() => ({
	servers: [],
	loaded: false,

	async open() {
		try {
			useVllm.setState({ servers: (await vllmApi.list()).servers, loaded: true });
			take((await vllmApi.refresh(false)).servers);
		} catch {
			useVllm.setState({ loaded: true });
		}
	},

	async sync() {
		const servers = take((await vllmApi.refresh(true)).servers);

		if (servers.some((server) => server.error)) throw new Error('A server could not be reached.');
	},

	async connect(baseUrl, apiKey) {
		const { servers, connected } = await vllmApi.connect(baseUrl, apiKey);

		return take(servers).find((server) => server.id === connected)!;
	},

	async disconnect(id) {
		take((await vllmApi.disconnect(id)).servers);
	}
}));
