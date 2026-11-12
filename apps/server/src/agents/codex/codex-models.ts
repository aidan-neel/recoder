import { REASONING_EFFORTS, supportedEffort, type ModelEntry, type ReasoningEffort } from '@recoder/shared';
import { z } from 'zod';
import { parseJson } from './codex-output';

/** Prefix of a Codex model's id in the Model select, so routing knows the CLI runs it. */
const CODEX_MODEL_PREFIX = 'codex:';

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
