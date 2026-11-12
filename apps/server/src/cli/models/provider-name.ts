import { appName, endpointProviderName } from '@recoder/shared';
import { hostedProvider } from '../../models/model-providers.js';
import type { KnownModel } from '../run/model-choices.js';

/**
 * The name the app's model picker groups a model under: the agent CLI it runs on, else the hosted or
 * OpenCode provider it came from, else what the endpoint's address says.
 */
export function providerNameOf(model: Pick<KnownModel, 'provider' | 'source' | 'baseUrl'>): string {
	const app = appName(model.provider);

	if (app) return app;

	if (model.source) return hostedProvider(model.source)?.name ?? model.source;

	return endpointProviderName(model.baseUrl ?? '');
}
