/** Reasoning levels in ascending depth; providers offer a subset. */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Each effort's name and what it costs, for pickers. */
export const EFFORT_TEXT: Record<ReasoningEffort, { label: string; description: string }> = {
	minimal: { label: 'Minimal', description: 'Near-instant' },
	low: { label: 'Low', description: 'Fastest, fewest tokens' },
	medium: { label: 'Medium', description: 'Balanced speed and depth' },
	high: { label: 'High', description: 'Slower, uses more of your plan' },
	xhigh: { label: 'Extra high', description: 'Deeper reasoning for hard problems' },
	max: { label: 'Max', description: 'Maximum depth, slowest' }
};

/** Effort words are always spelled out in full ("Medium", never "Med"). */
export function effortLabel(effort: ReasoningEffort): string {
	return EFFORT_TEXT[effort].label;
}

/**
 * How many subagents one review may run in all, chosen in Settings → Review harness; 0 turns them off.
 * `uncapped` runs one for every question that warrants it, as far as the review's model calls and time allow.
 * A string rather than `Infinity`, so it survives JSON.
 */
export const SUBAGENT_CAPS = [0, 2, 4, 'uncapped'] as const;
export type SubagentCap = (typeof SUBAGENT_CAPS)[number];
export const DEFAULT_SUBAGENT_CAP: SubagentCap = 2;

/**
 * How many tokens a review may spend, chosen in Settings → Review harness. One pick sets the subagent cap and both
 * reasoning efforts, and decides how long reviewers may run (`budgetLimits` on the server). Medium is what a review
 * did before budgets existed.
 */
export const TOKEN_BUDGETS = ['low', 'medium', 'high'] as const;
export type TokenBudget = (typeof TOKEN_BUDGETS)[number];
export const DEFAULT_TOKEN_BUDGET: TokenBudget = 'medium';

/** The cap a picker's string value stands for, so `'uncapped'` stays a string and the counts become numbers again. */
export function subagentCapFrom(value: string): SubagentCap {
	return SUBAGENT_CAPS.find((cap) => String(cap) === value) ?? DEFAULT_SUBAGENT_CAP;
}

/** How Recoder reaches a model: an OpenAI-compatible endpoint, ChatGPT, or the OpenCode, Claude Code or Devin CLI. */
export type ModelProvider = 'openai-compatible' | 'codex' | 'opencode' | 'claude-code' | 'devin';

/** Providers that are an app or CLI rather than an endpoint, by the name people know them by. */
const APP_NAMES: Partial<Record<ModelProvider, string>> = {
	codex: 'ChatGPT',
	'claude-code': 'Claude Code',
	devin: 'Devin'
};

/** ChatGPT, Claude Code or Devin for those providers; null for an endpoint or an OpenCode provider. */
export function appName(provider: ModelProvider | undefined): string | null {
	return (provider && APP_NAMES[provider]) || null;
}

/** Sampling settings a model wants; an unset field takes the built-in profile for the model, then the default. */
export interface ModelRuntimeProfile {
	/** `null` leaves the field out of the request, for models that reject or ignore it. */
	temperature?: number | null;
	/** Output-token cap per review turn. */
	maxOutputTokens?: number;
	topP?: number;
}

/** A named model entry in the registry (keys never leave the server). */
export interface ModelEntry {
	provider?: ModelProvider;
	/** Hosted provider this model came from (`opencode-go`, `openrouter`…); unset for ChatGPT and the custom endpoint. */
	source?: string;
	/** The agent CLI that runs this model, by name (`OpenCode`); unset for direct endpoints. */
	agent?: string;
	id: string;
	label: string;
	model: string;
	baseUrl: string | null;
	apiKeyPreview: string | null;
	/** Reasoning levels this model accepts, when the provider reports them. */
	efforts?: ReasoningEffort[];
	/** The provider's default level for this model. */
	defaultEffort?: ReasoningEffort;
	/** Max tokens per request (prompt + output), when the endpoint reports it. */
	contextWindow?: number;
	/** The server no longer lists this model; a review still set to it stops with a message until another is picked. */
	unavailable?: boolean;
	/** Sampling overrides for this model, set in the settings file or API. */
	runtime?: ModelRuntimeProfile;
}

/** A model an OpenAI-compatible endpoint serves (`GET {baseUrl}/models`). */
export interface DiscoveredModel {
	id: string;
	contextWindow: number | null;
	ownedBy: string | null;
}

export interface ModelEntryPatch {
	provider?: 'openai-compatible' | 'codex';
	source?: string;
	id?: string;
	label: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
	efforts?: ReasoningEffort[];
	defaultEffort?: ReasoningEffort;
	contextWindow?: number;
	runtime?: ModelRuntimeProfile;
}

/** A hosted model provider you connect with an API key (OpenCode Go, OpenRouter…). */
export interface HostedProvider {
	id: string;
	name: string;
	/** One line on what the plan gives you. */
	blurb: string;
	/** Where to create an API key. */
	keyUrl: string;
	/** Where to check usage; null when the provider has no page for it. */
	usageUrl: string | null;
	connected: boolean;
	apiKeyPreview: string | null;
}

/** A model a hosted provider serves, from its catalog. */
export interface CatalogModel {
	id: string;
	name: string;
	contextWindow: number | null;
	/** Input price in USD per million tokens, when known. */
	inputCost: number | null;
	/** False when the model needs an API Recoder doesn't speak yet (Responses, Anthropic Messages). */
	supported: boolean;
	/** Reasoning levels the model accepts, when the provider reports them. */
	efforts?: ReasoningEffort[];
	defaultEffort?: ReasoningEffort;
}

/** Reviewer model configuration (keys are never exposed). */
export interface ModelSettings {
	configured: boolean;
	baseUrl: string;
	model: string;
	apiKeyPreview: string | null;
	sharedModelId: string | null;
	orchestratorModelId?: string | null;
	/** Subagents and verifiers run on this second model; null follows the Review model. */
	specialistModelId?: string | null;
	models: ModelEntry[];
	/** Review (orchestrator) reasoning effort; null follows the model default. */
	orchestratorEffort?: ReasoningEffort | null;
	/** The second model's reasoning effort; null follows the Review effort when the model does too. */
	specialistEffort?: ReasoningEffort | null;
	/** How many subagents one review may run in all. */
	subagentCap: SubagentCap;
	/** The token budget last picked, whose limits reviews run with; the cap and efforts may since have been changed by hand. */
	tokenBudget: TokenBudget;
	/** Whether reviews report low-severity findings; off keeps them to medium and above. */
	reportLowSeverity: boolean;
	/** Where overrides are saved, e.g. `~/.recoder/data/review-config.json`. */
	configPath?: string;
	limits: { maxFiles: number; maxDiffChars: number; maxFileChars: number };
}

export interface ModelSettingsPatch {
	baseUrl?: string;
	apiKey?: string;
	models?: ModelEntryPatch[];
	sharedModelId?: string | null;
	orchestratorModelId?: string | null;
	specialistModelId?: string | null;
	orchestratorEffort?: ReasoningEffort | null;
	specialistEffort?: ReasoningEffort | null;
	subagentCap?: SubagentCap;
	tokenBudget?: TokenBudget;
	reportLowSeverity?: boolean;
	maxFiles?: number;
	maxDiffChars?: number;
	maxFileChars?: number;
}

export interface CodexConnection {
	available: boolean;
	authenticated: boolean;
	email?: string | null;
	planType?: string | null;
	error?: string;
	login?: { verificationUrl: string; userCode: string; expiresAt: number };
	limits?: Array<{ name: string; usedPercent: number; resetsAt: number | null }>;
}

export interface CodexModel {
	id: string;
	label: string;
	/** Reasoning levels the provider reports for this model. */
	efforts?: ReasoningEffort[];
	defaultEffort?: ReasoningEffort;
}

/**
 * The effort a model starts on: the provider's default when the model offers
 * it, else Medium, else the first effort it offers. Null when the model has no
 * reasoning control.
 */
export function defaultEffort(entry: Pick<ModelEntry, 'efforts' | 'defaultEffort'>): ReasoningEffort | null {
	const efforts = entry.efforts;

	if (!efforts?.length) return null;
	if (entry.defaultEffort && efforts.includes(entry.defaultEffort)) return entry.defaultEffort;

	return efforts.includes('medium') ? 'medium' : efforts[0];
}

/** A picker's view of a model's reasoning control. */
export interface EffortChoices {
	/** The efforts it offers, as names or as picker options with an `id`; null when it has no reasoning control. */
	efforts: readonly (ReasoningEffort | { id: ReasoningEffort })[] | null;
	defaultEffort: ReasoningEffort | null;
}

/** Keeps an effort only when the model offers it; otherwise the model's default. Null when the model has no reasoning control. */
export function resolveEffort(
	model: EffortChoices | undefined,
	effort: ReasoningEffort | null | undefined
): ReasoningEffort | null {
	if (!model?.efforts) return null;

	const offered = model.efforts.some((option) => (typeof option === 'string' ? option : option.id) === effort);

	return effort && offered ? effort : model.defaultEffort;
}
