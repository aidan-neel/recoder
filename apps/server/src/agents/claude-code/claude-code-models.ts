import type { ModelEntry, ReasoningEffort } from '@recoder/shared';

/** Prefix of a Claude Code model's id in the Model select, so routing knows the CLI runs it. */
export const CLAUDE_CODE_MODEL_PREFIX = 'claude-code:';

/** The levels `claude --effort` takes. Recoder's `minimal` has no CLI level, so it is not offered. */
const CLI_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Claude Code uses a 200K window unless a `[1m]` model is picked, which Recoder does not offer. */
const CONTEXT_WINDOW = 200_000;

interface ClaudeCodeModel {
	model: string;
	label: string;
	/** Unset for models that take no effort level (Haiku 4.5 rejects one). */
	efforts?: ReasoningEffort[];
}

/** The full ids, then the aliases `claude --help` documents, which follow the latest model of each family. */
const MODELS: ClaudeCodeModel[] = [
	{ model: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: CLI_EFFORTS },
	{ model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: CLI_EFFORTS },
	{ model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', efforts: CLI_EFFORTS },
	{ model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
	{ model: 'opus', label: 'Opus (latest)', efforts: CLI_EFFORTS },
	{ model: 'sonnet', label: 'Sonnet (latest)', efforts: CLI_EFFORTS },
	{ model: 'haiku', label: 'Haiku (latest)', efforts: CLI_EFFORTS },
	{ model: 'fable', label: 'Fable (latest)', efforts: CLI_EFFORTS }
];

/** Recoder's default level for a model that takes one. */
const DEFAULT_EFFORT: ReasoningEffort = 'high';

/** The model's effort levels and default; both unset for a model without levels or one Claude Code does not list. */
export function claudeCodeEfforts(model: string): Pick<ModelEntry, 'efforts' | 'defaultEffort'> {
	const efforts = MODELS.find((entry) => entry.model === model)?.efforts;

	return efforts ? { efforts, defaultEffort: DEFAULT_EFFORT } : {};
}

/** The static list the Model select shows under Claude Code; the CLI has no command that lists models. */
export function claudeCodeModels(): ModelEntry[] {
	return MODELS.map(({ model, label }) => ({
		id: `${CLAUDE_CODE_MODEL_PREFIX}${model}`,
		provider: 'claude-code',
		label,
		model,
		baseUrl: null,
		apiKeyPreview: null,
		contextWindow: CONTEXT_WINDOW,
		...claudeCodeEfforts(model)
	}));
}
