import { REASONING_EFFORTS, supportedEffort, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { z } from 'zod';
import { parseJson } from './codex-output';

/** Prefix of a Codex model's id in the Model select, so routing knows the CLI runs it. */
export const CODEX_MODEL_PREFIX = 'codex:';

/** The levels every model of the catalog took when it was read (2026-11-12), for a model not listed yet. */
const COMMON_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const FALLBACK_EFFORT: ReasoningEffort = 'medium';

const levelSchema = z.object({ effort: z.string() });

/** One model of `codex debug models`, as far as Recoder reads it; the catalog carries much more. */
const modelSchema = z.object({
	slug: z.string().min(1),
	display_name: z.string().optional(),
	visibility: z.string().optional(),
	default_reasoning_level: z.string().nullish(),
	supported_reasoning_levels: z.array(levelSchema).nullish(),
	context_window: z.number().int().positive().nullish()
});

const catalogSchema = z.object({ models: z.array(z.unknown()) });

/** The whole catalog, every field of it and of each model kept, for the copy the calls name. */
const fullCatalogSchema = z.looseObject({ models: z.array(z.record(z.string(), z.unknown())) });

/**
 * The catalog field that gives a model the CLI's sub-agent tools: `v1` a deferred `multi_agent_v1` namespace, `v2`
 * the `collaboration` namespace (`spawn_agent`, `send_message`, `wait_agent` …). `--disable multi_agent` does not
 * take them away; a model with no such field has none (codex-cli 0.167.0, `codex debug prompt-input`).
 */
const SUBAGENT_VERSION_FIELD = 'multi_agent_version';

function isEffort(value: unknown): value is ReasoningEffort {
	return REASONING_EFFORTS.some((effort) => effort === value);
}

/**
 * The models people can pick, from the JSON `codex debug models` prints: the catalog's listed models (hidden ones,
 * such as the CLI's own review model, are left out), with their effort levels as far as Recoder has a name for them
 * (it has none for `ultra`). A model entry the schema does not fit is skipped; a catalog that is not JSON lists none.
 */
export function parseCodexModels(output: string): ModelEntry[] {
	const catalog = catalogSchema.safeParse(parseJson(output));

	if (!catalog.success) return [];

	return catalog.data.models.flatMap((raw) => {
		const parsed = modelSchema.safeParse(raw);

		if (!parsed.success || (parsed.data.visibility && parsed.data.visibility !== 'list')) return [];

		return [modelEntry(parsed.data)];
	});
}

/**
 * The JSON `codex debug models` printed, with no model naming a sub-agent version, for the calls to name as their
 * catalog (`model_catalog_json`), so no model is offered sub-agents. Null when the output is not a catalog.
 */
export function catalogWithoutSubagents(output: string): string | null {
	const catalog = fullCatalogSchema.safeParse(parseJson(output));

	if (!catalog.success) return null;

	const models = catalog.data.models.map((model) =>
		Object.fromEntries(Object.entries(model).filter(([field]) => field !== SUBAGENT_VERSION_FIELD))
	);

	return JSON.stringify({ ...catalog.data, models });
}

function modelEntry(model: z.infer<typeof modelSchema>): ModelEntry {
	const efforts = (model.supported_reasoning_levels ?? []).map((level) => level.effort).filter(isEffort);
	const listedDefault = model.default_reasoning_level;
	const defaultEffort = isEffort(listedDefault) && efforts.includes(listedDefault) ? listedDefault : undefined;

	return {
		id: `${CODEX_MODEL_PREFIX}${model.slug}`,
		provider: 'codex',
		label: model.display_name || model.slug,
		model: model.slug,
		baseUrl: null,
		apiKeyPreview: null,
		...(model.context_window ? { contextWindow: model.context_window } : {}),
		...(efforts.length ? { efforts } : {}),
		...(defaultEffort ? { defaultEffort } : {})
	};
}

/**
 * The effort `model` runs at: the picked one when the model offers it, else its default. A model the adapter has
 * not listed yet is taken to offer the levels every listed model offered.
 */
export function codexEffort(
	listed: ModelEntry | undefined,
	requested: ReasoningEffort | undefined
): ReasoningEffort | undefined {
	const defaultEffort = listed?.defaultEffort ?? FALLBACK_EFFORT;

	return supportedEffort(requested ?? defaultEffort, listed?.efforts ?? COMMON_EFFORTS, defaultEffort);
}
