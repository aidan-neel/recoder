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

/** How many subagents one review may run in all, chosen in Settings → Review harness; 0 turns them off. */
export const SUBAGENT_CAPS = [0, 2, 4] as const;
export type SubagentCap = (typeof SUBAGENT_CAPS)[number];
export const DEFAULT_SUBAGENT_CAP: SubagentCap = 2;

/** How Recoder reaches a model: an OpenAI-compatible endpoint, ChatGPT, or the OpenCode, Claude Code or Devin CLI. */
export type ModelProvider = 'openai-compatible' | 'codex' | 'opencode' | 'claude-code' | 'devin';

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
