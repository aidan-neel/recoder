import { endpointProviderName, type ServerCheck } from '@recoder/shared';
import { vllmEntries } from '../../models/vllm/vllm-models';
import { agentById, listedModel } from '../../agents/registry';
import { transportFor } from '../../models/llm/transports';
import { hostedProvider } from '../../models/model-providers';
import { configForOrchestrator, savedReviewModelId, withLockedModels, type ModelConfig } from '../../models/models';
import { providerName } from '../../models/provider-switches';
import { getStoredSettings } from '../../review/session/review-settings';

export function reviewModelLabel(model?: ModelConfig): string {
	const id = savedReviewModelId();
	const stored = getStoredSettings().models?.find((entry) => entry.id === id);
	const entry = id ? (listedModel(id) ?? vllmEntries().find((entry) => entry.id === id) ?? stored) : undefined;

	return entry?.label ?? model?.model ?? 'Review model';
}

export function reviewProviderLabel(model?: ModelConfig): string {
	const hosted = hostedProvider(model?.source);

	if (hosted) return hosted.name;
	if (model?.provider === 'opencode' && model.source) return providerName({ kind: 'opencode', id: model.source });
	if (model?.provider) return agentById(model.provider)?.name ?? 'Model provider';

	return model ? endpointProviderName(model.baseUrl) : 'Configured provider';
}

export async function checkModel(): Promise<ServerCheck> {
	const id = 'model';
	const fix = 'Check the review model in Settings → Agent.';
	let config: ModelConfig;

	try {
		config = withLockedModels(configForOrchestrator, 'minimal');
	} catch {
		return { id, state: 'fail', detail: 'No enabled review model is configured.', fix };
	}

	try {
		const name = reviewModelLabel(config);
		const started = performance.now();
		const timeoutMs = 30_000;

		const result = await transportFor(config.provider)({
			...config,
			temperature: config.runtime?.temperature,
			topP: config.runtime?.topP,
			messages: [{ role: 'user', content: 'Reply with the word OK.' }],
			maxTokens: 256,
			timeoutMs,
			signal: AbortSignal.timeout(timeoutMs)
		});

		const seconds = (performance.now() - started) / 1000;

		if (result.trim()) {
			const detail = `${name} answered in ${seconds.toFixed(1)}s.`;

			return seconds > 20 ? { id, state: 'warn', detail, fix } : { id, state: 'ok', detail };
		}
	} catch {}

	return { id, state: 'fail', detail: 'The review model did not answer the test request.', fix };
}
