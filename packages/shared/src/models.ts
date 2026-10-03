/** Reasoning levels in ascending depth; providers offer a subset. */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** How many specialists one review may dispatch, and how long each may dig. */
export const DISPATCH_LEVELS = ['low', 'medium', 'high'] as const;
export type DispatchLevel = (typeof DISPATCH_LEVELS)[number];

/** A named model entry in the registry (keys never leave the server). */
export interface ModelEntry {
	provider?: 'openai-compatible' | 'codex' | 'opencode';
	/** Hosted provider this model came from (`opencode-go`, `openrouter`…); unset for ChatGPT and the custom endpoint. */
	source?: string;
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
	/** Every specialist runs on this model; null follows the Review model. */
	specialistModelId?: string | null;
	models: ModelEntry[];
	/** Review (orchestrator) reasoning effort; null follows the model default. */
	orchestratorEffort?: ReasoningEffort | null;
	/** Specialist reasoning effort; null follows the Review effort when the model does too. */
	specialistEffort?: ReasoningEffort | null;
	/** Specialist dispatch: how many specialists a review may run (medium by default). */
	specialistDispatch: DispatchLevel;
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
	specialistDispatch?: DispatchLevel;
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
