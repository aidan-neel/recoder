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
import codexRoutes from './codex';

function mask(key: string | undefined): string | null {
	if (!key) return null;
	return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

/** Per-role model routing for the UI (null = use shared). */
function rolesPayload(): Record<string, string | null> {
	const stored = getStoredSettings();
	return Object.fromEntries(REVIEW_ROLES.map((role) => [role, stored.roles?.[role] ?? null]));
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
			...(e.defaultEffort ? { defaultEffort: e.defaultEffort } : {})
		})),
		roles: rolesPayload(),
		roleEfforts: stored.roleEfforts ?? {},
		orchestratorEffort: stored.orchestratorEffort ?? null,
		applyToSpecialists: stored.applyToSpecialists ?? false,
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

export default app;
