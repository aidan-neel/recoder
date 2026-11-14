/** Prefix for registry ids of vLLM models: `vllm:<server id>/<model id>`. */
export const VLLM_MODEL_PREFIX = 'vllm:';

/** A model a vLLM server serves, as last captured from its `GET /v1/models`. */
export interface VllmModel {
	/** The id the server serves it under; this is what a request names. */
	id: string;
	/** Tokens per request (`max_model_len`); null when the server did not say. */
	contextWindow: number | null;
	/** False once the server stopped listing it while a review is still set to it. */
	served: boolean;
}

/** A vLLM server Recoder keeps its model list in step with. Keys never leave the server. */
export interface VllmServer {
	id: string;
	/** `host:port`, for display. */
	host: string;
	/** The working OpenAI-compatible base, ending in `/v1`. */
	baseUrl: string;
	/** Whether a key is saved. The key itself is never returned, not even in part. */
	apiKeySet: boolean;
	/** When the model list last matched the server, in ms; null until the first sync. */
	syncedAt: number | null;
	/** Why the latest sync failed, in plain words; null when it worked. The models are the last good list. */
	error: string | null;
	models: VllmModel[];
}

/** The registry id of one of a server's models. */
export function vllmModelId(serverId: string, model: string): string {
	return `${VLLM_MODEL_PREFIX}${serverId}/${model}`;
}

/** A vLLM registry id's server and model, or null for any other id. */
export function parseVllmModelId(id: string): { serverId: string; model: string } | null {
	if (!id.startsWith(VLLM_MODEL_PREFIX)) return null;

	const rest = id.slice(VLLM_MODEL_PREFIX.length);
	const slash = rest.indexOf('/');

	return slash > 0 && slash < rest.length - 1 ? { serverId: rest.slice(0, slash), model: rest.slice(slash + 1) } : null;
}
