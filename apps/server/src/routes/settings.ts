import { Hono } from 'hono';
import {
	effectiveDispatchLevel,
	effectiveReviewEnv,
	getStoredSettings,
	maskKey,
	settingsFileDisplay,
	reviewSettingsSchema,
	saveReviewSettings,
	setConnection
} from '../review/session/review-settings';
import {
	HOSTED_PROVIDERS,
	KeyRejectedError,
	hostedProvider,
	providerCatalog,
	verifyKey
} from '../models/model-providers';
import type { HostedProvider, ModelEntry } from '@recoder/shared';
import { opencode } from '../agents/opencode/opencode';
import { isReviewConfigured } from '../models/models';
import { z } from 'zod';
import { discoverModels } from '../models/model-discovery';
import codexRoutes from './codex';
import { parseBody } from './parse-body';

const app = new Hono();

app.route('/codex', codexRoutes);

/** The agent's models; empty while OpenCode is missing or down, so Settings still opens. */
async function agentModels(): Promise<ModelEntry[]> {
	try {
		return await opencode.models();
	} catch {
		return [];
	}
}

/** Effective reviewer model config. Keys are never returned in full. Models come from the agent. */
async function settingsPayload() {
	const eff = effectiveReviewEnv();
	const stored = getStoredSettings();

	return {
		configured: isReviewConfigured(),
		baseUrl: eff.baseUrl,
		model: eff.model,
		apiKeyPreview: maskKey(eff.apiKey),
		sharedModelId: stored.sharedModelId ?? null,
		orchestratorModelId: stored.orchestratorModelId ?? null,
		specialistModelId: stored.specialistModelId ?? null,
		models: await agentModels(),
		orchestratorEffort: stored.orchestratorEffort ?? null,
		specialistEffort: stored.specialistEffort ?? null,
		specialistDispatch: effectiveDispatchLevel(),
		configPath: settingsFileDisplay(),
		limits: {
			maxFiles: eff.maxFiles,
			maxDiffChars: eff.maxDiffChars,
			maxFileChars: eff.maxFileChars
		}
	};
}

app.get('/models', async (c) => c.json(await settingsPayload()));

/** Merge a validated patch over the stored model settings. Empty key keeps the existing one. */
app.on(['PUT', 'PATCH'], '/models', async (c) => {
	const body = await parseBody(c, reviewSettingsSchema);

	if (body instanceof Response) return body;

	saveReviewSettings(body);

	return c.json(await settingsPayload());
});

const discoverSchema = z.object({ baseUrl: z.string().max(500).optional(), apiKey: z.string().max(500).optional() });

/** List what an OpenAI-compatible endpoint serves. Blank fields fall back to the saved endpoint. */
app.post('/models/discover', async (c) => {
	const parsed = discoverSchema.safeParse(await c.req.json().catch(() => ({})));

	if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

	const eff = effectiveReviewEnv();
	const baseUrl = parsed.data.baseUrl?.trim() || eff.baseUrl;

	if (!baseUrl) return c.json({ error: 'Set a base URL first.' }, 400);

	try {
		return c.json(await discoverModels(baseUrl, parsed.data.apiKey?.trim() || eff.apiKey));
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : 'Could not list models.' }, 502);
	}
});

/** Hosted providers and whether each has a key. Keys are masked. */
function providersPayload(): HostedProvider[] {
	const connections = getStoredSettings().connections ?? {};

	return HOSTED_PROVIDERS.map((provider) => ({
		id: provider.id,
		name: provider.name,
		blurb: provider.blurb,
		keyUrl: provider.keyUrl,
		usageUrl: provider.usageUrl,
		connected: !!connections[provider.id],
		apiKeyPreview: maskKey(connections[provider.id]?.apiKey)
	}));
}

app.get('/providers', (c) => c.json(providersPayload()));

const connectSchema = z.object({ apiKey: z.string().trim().min(1).max(500) });

/**
 * Bumped by every disconnect. A connect captures it before checking the key
 * (which can take seconds) and saves only if it hasn't moved, so a disconnect
 * that lands meanwhile stays final.
 */
const disconnects = new Map<string, number>();

/** Check the key with a request that runs no model, then save it. */
app.post('/providers/:id/connect', async (c) => {
	const provider = hostedProvider(c.req.param('id'));

	if (!provider) return c.json({ error: 'unknown provider' }, 404);

	const parsed = connectSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Paste an API key.' }, 400);

	const generation = disconnects.get(provider.id) ?? 0;

	try {
		await verifyKey(provider, parsed.data.apiKey);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Could not check the key.';

		return c.json({ error: message }, err instanceof KeyRejectedError ? 401 : 502);
	}

	if ((disconnects.get(provider.id) ?? 0) !== generation) {
		return c.json({ error: `${provider.name} was disconnected while the key was being checked.` }, 409);
	}

	setConnection(provider.id, parsed.data.apiKey);

	return c.json({ providers: providersPayload(), settings: await settingsPayload() });
});

/** Forget the key and every model added from this provider. */
app.delete('/providers/:id', async (c) => {
	const provider = hostedProvider(c.req.param('id'));

	if (!provider) return c.json({ error: 'unknown provider' }, 404);
	disconnects.set(provider.id, (disconnects.get(provider.id) ?? 0) + 1);
	setConnection(provider.id, null);

	return c.json({ providers: providersPayload(), settings: await settingsPayload() });
});

/** Every model the provider serves, marked by whether Recoder can call it. */
app.get('/providers/:id/catalog', async (c) => {
	const provider = hostedProvider(c.req.param('id'));

	if (!provider) return c.json({ error: 'unknown provider' }, 404);

	try {
		return c.json(await providerCatalog(provider));
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : 'Could not load the model list.' }, 502);
	}
});

export default app;
