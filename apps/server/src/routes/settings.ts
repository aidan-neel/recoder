import { Hono, type Context } from 'hono';
import {
	effectiveReviewEnv,
	effectiveReportLowSeverity,
	effectiveSubagentCap,
	effectiveTokenBudget,
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
import { within, type HostedProvider, type ModelEntry, type SetupStatus } from '@recoder/shared';
import { opencode } from '../agents/opencode/opencode';
import { agentModels, pickedModels } from '../agents/registry';
import { vllmEntries } from '../models/vllm/vllm-models';
import { isReviewConfigured } from '../models/models';
import { z } from 'zod';
import { discoverModels } from '../models/model-discovery';
import { db } from '../store';
import codexRoutes from './codex';
import { parseBody } from './parse-body';

const app = new Hono();

app.route('/codex', codexRoutes);

/**
 * How long a write waits on an agent's fresh model listing (after the lists
 * were cleared) before it answers with the models that agent listed last.
 * The listing goes on and fills the cache for the next read; a write never
 * waits out a slow CLI.
 */
const WRITE_WAIT_MS = 2_500;

/**
 * The models the settings offer: the captured vLLM models, then every model
 * the agents run, or with `catalog` off only the picked ones. `waitMs` bounds
 * the wait on a fresh listing.
 */
async function offeredModels(catalog: boolean, waitMs?: number): Promise<ModelEntry[]> {
	if (catalog) return [...vllmEntries(), ...(await agentModels(waitMs))];

	const { sharedModelId, orchestratorModelId, specialistModelId, verifierModelId } = getStoredSettings();
	const picked = [sharedModelId, orchestratorModelId, specialistModelId, verifierModelId];

	return [...vllmEntries().filter((entry) => picked.includes(entry.id)), ...(await pickedModels(picked, waitMs))];
}

/**
 * Effective reviewer model config. Keys are never returned in full. Models
 * are the captured vLLM models and the agents': the whole catalog, or with `catalog` off only the
 * picked models' entries, for a page that shows the picks, limits and
 * toggles but no picker yet.
 */
async function settingsPayload(catalog = true, waitMs?: number) {
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
		verifierModelId: stored.verifierModelId ?? null,
		models: await offeredModels(catalog, waitMs),
		orchestratorEffort: stored.orchestratorEffort ?? null,
		specialistEffort: stored.specialistEffort ?? null,
		verifierEffort: stored.verifierEffort ?? null,
		subagentCap: effectiveSubagentCap(),
		tokenBudget: effectiveTokenBudget(),
		reportLowSeverity: effectiveReportLowSeverity(),
		configPath: settingsFileDisplay(),
		limits: {
			maxFiles: eff.maxFiles,
			maxDiffChars: eff.maxDiffChars,
			maxFileChars: eff.maxFileChars
		}
	};
}

/** `?catalog=0` leaves the catalog out (the picks keep their entries); without it the answer is unchanged, for apps/web. */
function wantsCatalog(c: Context): boolean {
	return c.req.query('catalog') !== '0';
}

app.get('/models', async (c) => c.json(await settingsPayload(wantsCatalog(c))));

/** True when OpenCode has a model provider connected; false when it has none, or is missing or down (its last check says which). */
async function openCodeConnected(): Promise<boolean> {
	const status = await opencode.detect();

	if (!status.installed || status.error) return false;

	return opencode.providers().then(
		(providers) => providers.some((provider) => provider.connected),
		() => false
	);
}

/**
 * How long the setup status waits on a slow agent. An agent still listing
 * counts the models it listed last, and OpenCode still starting counts as no
 * provider yet; the work goes on and fills the caches for the next read. It
 * sits under the app's 3 s wait on the check, so the gate decides on this
 * answer, and far under Bun's 10 s idle timeout, which would cut the request
 * off (a cold Devin listing can take 20 s).
 */
const STATUS_WAIT_MS = 2_000;

/**
 * What first run needs, without the model catalog. OpenCode's providers are
 * asked only when no model is configured, which is first run's own case, and
 * alongside the model count, so the answer waits {@link STATUS_WAIT_MS} at
 * most.
 */
app.get('/status', async (c) => {
	const configured = isReviewConfigured();

	const [models, openCode] = await Promise.all([
		offeredModels(true, STATUS_WAIT_MS),
		configured || within(openCodeConnected(), STATUS_WAIT_MS, false)
	]);

	const status: SetupStatus = {
		configured,
		modelCount: models.length,
		providerConnected: configured || models.length > 0 || openCode,
		repoCount: (await db.repos.list()).length
	};

	return c.json(status);
});

/**
 * Merge a validated patch over the stored model settings. Empty key keeps the
 * existing one. Nothing here changes what the agents offer, so the answer
 * comes from the model lists already cached.
 */
app.on(['PUT', 'PATCH'], '/models', async (c) => {
	const body = await parseBody(c, reviewSettingsSchema);

	if (body instanceof Response) return body;

	saveReviewSettings(body);

	return c.json(await settingsPayload(wantsCatalog(c), WRITE_WAIT_MS));
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

	return c.json({ providers: providersPayload(), settings: await settingsPayload(true, WRITE_WAIT_MS) });
});

/** Forget the key and every model added from this provider. */
app.delete('/providers/:id', async (c) => {
	const provider = hostedProvider(c.req.param('id'));

	if (!provider) return c.json({ error: 'unknown provider' }, 404);
	disconnects.set(provider.id, (disconnects.get(provider.id) ?? 0) + 1);
	setConnection(provider.id, null);

	return c.json({ providers: providersPayload(), settings: await settingsPayload(true, WRITE_WAIT_MS) });
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
