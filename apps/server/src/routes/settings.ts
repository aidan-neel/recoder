import { Hono } from 'hono';
import {
	apiKeyPreview,
	effectiveReviewEnv,
	getStoredSettings,
	reviewSettingsSchema,
	saveReviewSettings
} from '../lib/review-settings';
import { isReviewConfigured } from '../lib/models';

function mask(key: string | undefined): string | null {
	if (!key) return null;
	return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

const app = new Hono();

/** Effective reviewer model config. Keys are never returned in full. */
app.get('/models', (c) => {
	const eff = effectiveReviewEnv();
	const stored = getStoredSettings();
	return c.json({
		configured: isReviewConfigured(),
		baseUrl: eff.baseUrl,
		model: eff.model,
		apiKeyPreview: apiKeyPreview(),
		sharedModelId: stored.sharedModelId ?? null,
		models: (stored.models ?? []).map((e) => ({
			id: e.id,
			label: e.label,
			model: e.model,
			baseUrl: e.baseUrl ?? null,
			apiKeyPreview: mask(e.apiKey)
		})),
		roles: {
			security: stored.roles?.security ?? null,
			perf: stored.roles?.perf ?? null,
			correctness: stored.roles?.correctness ?? null,
			docs: stored.roles?.docs ?? null
		},
		limits: {
			maxFiles: eff.maxFiles,
			maxDiffChars: eff.maxDiffChars,
			maxFileChars: eff.maxFileChars
		}
	});
});

/** Merge a validated patch over the stored model settings. Empty key keeps the existing one. */
app.put('/models', async (c) => {
	const parsed = reviewSettingsSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	saveReviewSettings(parsed.data);
	const eff = effectiveReviewEnv();
	const stored = getStoredSettings();
	return c.json({
		configured: isReviewConfigured(),
		baseUrl: eff.baseUrl,
		model: eff.model,
		apiKeyPreview: apiKeyPreview(),
		sharedModelId: stored.sharedModelId ?? null,
		models: (stored.models ?? []).map((e) => ({
			id: e.id,
			label: e.label,
			model: e.model,
			baseUrl: e.baseUrl ?? null,
			apiKeyPreview: mask(e.apiKey)
		})),
		roles: {
			security: stored.roles?.security ?? null,
			perf: stored.roles?.perf ?? null,
			correctness: stored.roles?.correctness ?? null,
			docs: stored.roles?.docs ?? null
		},
		limits: {
			maxFiles: eff.maxFiles,
			maxDiffChars: eff.maxDiffChars,
			maxFileChars: eff.maxFileChars
		}
	});
});

export default app;
