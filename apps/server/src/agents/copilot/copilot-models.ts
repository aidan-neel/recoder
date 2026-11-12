import type { ModelEntry, ReasoningEffort } from '@recoder/shared';

/** Prefix of a Copilot model's id in the Model select, so routing knows the CLI runs it. */
const COPILOT_MODEL_PREFIX = 'copilot:';

/** The levels `--reasoning-effort` takes that Recoder offers; the CLI also takes `none`, which Recoder does not list. */
const CLI_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The level the picker shows selected. Which models honor an effort is the CLI's per-model business; when a
 * request names none, no flag is passed and the model runs at its own default.
 */
const DEFAULT_EFFORT: ReasoningEffort = 'medium';

/**
 * The context window assumed for every model. The CLI reports none and only names a tier switch
 * (`--context default|long_context`), so reviews budget for the smaller tier rather than the advertised one.
 */
const CONTEXT_WINDOW = 200_000;

interface CopilotModel {
	model: string;
	label: string;
}

/**
 * The model ids `copilot help config` documents for the `model` setting, plus `auto`, which the `--model` help
 * and `COPILOT_AUTO_TIER` name. `/model` reads a catalog the account's plan advertises and the CLI has no
 * command that lists models, so this documented set is all that can be offered; a plan-gated id fails loudly
 * at call time.
 */
const MODELS: CopilotModel[] = [
	{ model: 'auto', label: 'Auto (Copilot picks)' },
	{ model: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
	{ model: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
	{ model: 'claude-fable-5.2', label: 'Claude Fable 5.2' },
	{ model: 'claude-fable-5.1', label: 'Claude Fable 5.1' },
	{ model: 'claude-fable-5', label: 'Claude Fable 5' },
	{ model: 'claude-opus-5.5', label: 'Claude Opus 5.5' },
	{ model: 'claude-opus-5', label: 'Claude Opus 5' },
	{ model: 'claude-opus-4.8', label: 'Claude Opus 4.8' },
	{ model: 'claude-opus-4.8-fast', label: 'Claude Opus 4.8 Fast' },
	{ model: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
	{ model: 'claude-haiku-5.5', label: 'Claude Haiku 5.5' },
	{ model: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
	{ model: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
	{ model: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
	{ model: 'gpt-6-sol', label: 'GPT-6 Sol' },
	{ model: 'gpt-6-luna', label: 'GPT-6 Luna' },
	{ model: 'gpt-6-astra', label: 'GPT-6 Astra' },
	{ model: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
	{ model: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
	{ model: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
	{ model: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
	{ model: 'mai-code-1.1-flash', label: 'MAI-Code 1.1 Flash' },
	{ model: 'gemini-4-argon', label: 'Gemini 4 Argon' },
	{ model: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
	{ model: 'grok-4.7', label: 'Grok 4.7' },
	{ model: 'grok-4.6', label: 'Grok 4.6' },
	{ model: 'kimi-k3', label: 'Kimi K3' }
];

/** The levels every model is offered, with the level the picker shows selected. */
export function copilotEfforts(): Pick<ModelEntry, 'efforts' | 'defaultEffort'> {
	return { efforts: CLI_EFFORTS, defaultEffort: DEFAULT_EFFORT };
}

/** The `--reasoning-effort` flags for a call: the picked level, or none so the model keeps its own default. */
export function effortArgs(requested: ReasoningEffort | undefined): string[] {
	return requested ? ['--reasoning-effort', requested] : [];
}

/** The static list the Model select shows under GitHub Copilot; the CLI has no command that lists models. */
export function copilotModels(): ModelEntry[] {
	return MODELS.map(({ model, label }) => ({
		id: `${COPILOT_MODEL_PREFIX}${model}`,
		provider: 'copilot',
		label,
		model,
		baseUrl: null,
		apiKeyPreview: null,
		contextWindow: CONTEXT_WINDOW,
		...copilotEfforts()
	}));
}
