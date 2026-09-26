import { Hono } from 'hono';
import {
	apiKeyPreview,
	effectiveReviewEnv,
	getStoredSettings,
	settingsFileDisplay,
	reviewSettingsSchema,
	saveReviewSettings
} from '../lib/review-settings';
import { isReviewConfigured } from '../lib/models';
import { REVIEW_ROLES } from '../lib/roles';
import { z } from 'zod';
import { discoverModels } from '../lib/model-discovery';
import codexRoutes from './codex';

function mask(key: string | undefined): string | null {
	if (!key) return null;
	return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}


const app = new Hono();
app.route('/codex', codexRoutes);

/** Effective reviewer model config. Keys are never returned in full. */
function settingsPayload() {
	const eff = effectiveReviewEnv();
	const stored = getStoredSettings();
	return {
		configured: isReviewConfigured(),
		baseUrl: eff.baseUrl,
		model: eff.model,
		apiKeyPreview: apiKeyPreview(),
		sharedModelId: stored.sharedModelId ?? null,
		orchestratorModelId: stored.orchestratorModelId ?? null,
		specialistModelId: stored.specialistModelId ?? null,
		models: (stored.models ?? []).map((e) => ({
			provider: e.provider ?? 'openai-compatible',
			id: e.id,
			label: e.label,
			model: e.model,
			baseUrl: e.baseUrl ?? null,
			apiKeyPreview: mask(e.apiKey),
			...(e.efforts?.length ? { efforts: e.efforts } : {}),
			...(e.defaultEffort ? { defaultEffort: e.defaultEffort } : {}),
			...(e.contextWindow ? { contextWindow: e.contextWindow } : {})
		})),
		orchestratorEffort: stored.orchestratorEffort ?? null,
		specialistEffort: stored.specialistEffort ?? null,
		configPath: settingsFileDisplay(),
		limits: {
			maxFiles: eff.maxFiles,
			maxDiffChars: eff.maxDiffChars,
			maxFileChars: eff.maxFileChars
		}
	};
}

app.get('/models', (c) => c.json(settingsPayload()));

/** Merge a validated patch over the stored model settings. Empty key keeps the existing one. */
app.on(['PUT', 'PATCH'], '/models', async (c) => {
	const parsed = reviewSettingsSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	saveReviewSettings(parsed.data);
	return c.json(settingsPayload());
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

export default app;
