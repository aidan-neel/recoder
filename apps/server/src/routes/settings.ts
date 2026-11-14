import { Hono, type Context } from 'hono';
import {
	effectiveReviewEnv,
	effectiveReportLowSeverity,
	effectiveSubagentCap,
	effectiveTokenBudget,
	disabledProviderKeys,
	effectiveModelPolicy,
	hiddenModelIds,
	getStoredSettings,
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
import { within, type HostedProvider, type SetupStatus } from '@recoder/shared';
import { opencode } from '../agents/opencode/opencode';
import { offeredModels, WRITE_WAIT_MS, type ModelListing } from '../models/offered-models';
import { knownHiddenModels, settingsPatchProblem } from '../models/model-policy';
import { isReviewConfigured, isReviewRunnable } from '../models/models';
import { providerSwitches, type ProviderSwitches } from '../models/provider-switches';
import { z } from 'zod';
import { discoverModels } from '../models/model-discovery';
import { db } from '../store';
import { parseBody } from './parse-body';

const app = new Hono();

/**
 * Effective reviewer model config. A key is never returned, only whether one is set. Models
 * are the captured vLLM models and the agents', as `listing` says: the pickable ones, every one for the chooser, or
 * only the picked models' entries, for a page that shows the picks, limits and toggles but no picker yet.
 */
async function settingsPayload(listing: ModelListing, waitMs?: number) {
	const eff = effectiveReviewEnv();
	const stored = getStoredSettings();

	return {
		configured: isReviewConfigured(),
		baseUrl: eff.baseUrl,
		model: eff.model,
		apiKeySet: eff.apiKey !== '',
		sharedModelId: stored.sharedModelId ?? null,
		orchestratorModelId: stored.orchestratorModelId ?? null,
		specialistModelId: stored.specialistModelId ?? null,
		verifierModelId: stored.verifierModelId ?? null,
		models: await offeredModels(listing, waitMs),
		orchestratorEffort: stored.orchestratorEffort ?? null,
		specialistEffort: stored.specialistEffort ?? null,
		verifierEffort: stored.verifierEffort ?? null,
		subagentCap: effectiveSubagentCap(),
		tokenBudget: effectiveTokenBudget(),
		reportLowSeverity: effectiveReportLowSeverity(),
		disabledProviders: disabledProviderKeys(),
		hiddenModels: hiddenModelIds(),
		modelPolicy: effectiveModelPolicy(),
		configPath: settingsFileDisplay(),
		limits: {
			maxFiles: eff.maxFiles,
			maxDiffChars: eff.maxDiffChars,
			maxFileChars: eff.maxFileChars
		}
	};
}

/**
 * Which models the answer lists: `?catalog=0` only the picked ones (the picks keep their entries), `?hidden=1` every
 * model of a switched-on provider with the hidden ones too, for the chooser; otherwise the models people pick from.
 */
function listingOf(c: Context): ModelListing {
	if (c.req.query('catalog') === '0') return { kind: 'picked' };

	return c.req.query('hidden') === '1' ? { kind: 'chooser' } : { kind: 'pickable' };
}

app.get('/models', async (c) => c.json(await settingsPayload(listingOf(c))));

/**
 * True when OpenCode has a model provider connected and switched on; false when it has none, is switched off, or is
 * missing or down (its last check says which).
 */
async function openCodeConnected(switches: ProviderSwitches): Promise<boolean> {
	if (!switches.isOn({ kind: 'cli', id: opencode.id })) return false;

	const status = await opencode.detect();

	if (!status.installed || status.error) return false;

	return opencode.providers().then(
		(providers) =>
			providers.some((provider) => provider.connected && switches.isOn({ kind: 'opencode', id: provider.id })),
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
 * What first run needs, without the model catalog. Only switched-on providers
 * count. OpenCode's providers are asked only when no picked model can run,
 * which is first run's own case, and alongside the model count, so the answer
 * waits {@link STATUS_WAIT_MS} at most.
 */
app.get('/status', async (c) => {
	const configured = isReviewConfigured();
	const runnable = isReviewRunnable();
	const switches = providerSwitches();

	const [models, openCode] = await Promise.all([
		offeredModels({ kind: 'chooser' }, STATUS_WAIT_MS),
		runnable || within(openCodeConnected(switches), STATUS_WAIT_MS, false)
	]);

	const status: SetupStatus = {
		configured,
		modelCount: models.length,
		providerConnected: runnable || models.length > 0 || openCode,
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

	const problem = await settingsPatchProblem(body);

	if (problem) return c.json({ error: problem }, 400);

	saveReviewSettings(body.hiddenModels ? { ...body, hiddenModels: await knownHiddenModels(body.hiddenModels) } : body);

	return c.json(await settingsPayload(listingOf(c), WRITE_WAIT_MS));
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

/** Hosted providers and whether each has a key. A key is never returned. */
function providersPayload(): HostedProvider[] {
	const connections = getStoredSettings().connections ?? {};

	return HOSTED_PROVIDERS.map((provider) => ({
		id: provider.id,
		name: provider.name,
		blurb: provider.blurb,
		keyUrl: provider.keyUrl,
		usageUrl: provider.usageUrl,
		connected: !!connections[provider.id],
		apiKeySet: !!connections[provider.id]?.apiKey
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

	return c.json({
		providers: providersPayload(),
		settings: await settingsPayload({ kind: 'pickable' }, WRITE_WAIT_MS)
	});
});

/** Forget the key and every model added from this provider. */
app.delete('/providers/:id', async (c) => {
	const provider = hostedProvider(c.req.param('id'));

	if (!provider) return c.json({ error: 'unknown provider' }, 404);
	disconnects.set(provider.id, (disconnects.get(provider.id) ?? 0) + 1);
	setConnection(provider.id, null);

	return c.json({
		providers: providersPayload(),
		settings: await settingsPayload({ kind: 'pickable' }, WRITE_WAIT_MS)
	});
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
