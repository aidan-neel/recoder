import type { ModelRuntimeProfile } from '@recoder/shared';

interface BuiltinProfile {
	match: RegExp;
	profile: ModelRuntimeProfile;
	/** The vendor page the values come from. */
	source: string;
}

const DEFAULT_TEMPERATURE = 0;

const DEFAULT_MAX_OUTPUT_TOKENS = 8000;

/**
 * Vendor-documented sampling for models that want something other than the
 * default. The first match wins and each value comes from the page named in
 * its `source`. Models with no entry run at the default.
 *
 * Left out on purpose: DeepSeek, whose coding temperature (0.0) is already the
 * default and whose thinking mode ignores `temperature`
 * (https://api-docs.deepseek.com/guides/thinking_mode); OpenAI reasoning
 * models, whose docs do not say `temperature` is rejected. Ornith also lists
 * `top_k=20`, which a profile has no field for.
 */
const BUILTIN_PROFILES: BuiltinProfile[] = [
	{
		match: /glm-?5[.-]3-flash/i,
		profile: { temperature: 1, topP: 0.95 },
		source: 'https://docs.z.ai/guides/llm/glm-5.3-flash'
	},
	{
		match: /ornith-1\.5/i,
		profile: { temperature: 0.6, topP: 0.95 },
		source: 'https://huggingface.co/ornith-ai/Ornith-1.5-397B'
	}
];

/**
 * The profile a model runs with. Each field comes from the entry's own
 * `runtime` if it sets it, else the first built-in profile matching the model
 * id, else is left unset (and {@link sampling} applies the default).
 */
export function resolveRuntime(model: string, explicit?: ModelRuntimeProfile): ModelRuntimeProfile {
	const builtin = BUILTIN_PROFILES.find((entry) => entry.match.test(model))?.profile;

	return { ...builtin, ...explicit };
}

/**
 * The sampling fields of a model call. With no profile this is today's
 * behaviour: temperature 0, and `maxTokens` as the caller asked for it (8000
 * for a review turn that asks for none). A profile's output cap replaces the
 * 8000 default and only ever lowers a caller's own cap.
 */
export function sampling(
	config: { runtime?: ModelRuntimeProfile },
	ownMaxTokens?: number
): { temperature: number | null; topP?: number; maxTokens: number } {
	const { temperature, topP, maxOutputTokens } = config.runtime ?? {};

	return {
		temperature: temperature === undefined ? DEFAULT_TEMPERATURE : temperature,
		...(topP === undefined ? {} : { topP }),
		maxTokens:
			ownMaxTokens === undefined
				? (maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)
				: Math.min(ownMaxTokens, maxOutputTokens ?? ownMaxTokens)
	};
}
