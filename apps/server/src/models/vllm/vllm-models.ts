import { parseVllmModelId, vllmModelId, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { maskKey } from '../../review/session/review-settings.js';
import { getVllmServer, listVllmServers, vllmHost, type StoredVllmServer } from './vllm-store.js';

/** vLLM does not report reasoning levels; gpt-oss is the served model family that takes them (`reasoning_effort`). */
const GPT_OSS = /gpt-oss/i;

const GPT_OSS_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];

function effortsFor(model: string): Pick<ModelEntry, 'efforts' | 'defaultEffort'> {
	return GPT_OSS.test(model) ? { efforts: GPT_OSS_EFFORTS, defaultEffort: 'medium' } : {};
}

function entriesOf(server: StoredVllmServer): ModelEntry[] {
	return server.models.map((model) => ({
		provider: 'openai-compatible',
		source: `vLLM · ${vllmHost(server.baseUrl)}`,
		id: vllmModelId(server.id, model.id),
		label: model.id,
		model: model.id,
		baseUrl: server.baseUrl,
		apiKeyPreview: maskKey(server.apiKey),
		...effortsFor(model.id),
		...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
		...(model.served ? {} : { unavailable: true })
	}));
}

/** Every captured model as a registry entry, for the model pickers. */
export function vllmEntries(): ModelEntry[] {
	return listVllmServers().flatMap(entriesOf);
}

/** What a call to one of the captured models needs: the endpoint, key and model id, and the efforts it takes. */
export interface VllmTarget {
	baseUrl: string;
	apiKey: string;
	model: string;
	efforts?: ReasoningEffort[];
	defaultEffort?: ReasoningEffort;
}

/**
 * Where a captured model runs, or the plain reason it cannot: its server was
 * disconnected, or the server stopped serving it. A review set to it stops
 * with that reason rather than quietly running on another model.
 */
export function vllmTarget(entryId: string): VllmTarget | { error: string } {
	const parsed = parseVllmModelId(entryId);
	const server = parsed ? getVllmServer(parsed.serverId) : undefined;

	if (!parsed || !server) return { error: 'That vLLM server isn’t connected. Connect it in Settings → Agent.' };

	if (!server.models.some((model) => model.id === parsed.model && model.served)) {
		return {
			error: `${parsed.model} is no longer served by ${vllmHost(server.baseUrl)}. Pick another model in Settings → Agent.`
		};
	}

	return { baseUrl: server.baseUrl, apiKey: server.apiKey ?? '', model: parsed.model, ...effortsFor(parsed.model) };
}
