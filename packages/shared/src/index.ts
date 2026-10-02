/**
 * @recoder/shared — contract + portable utilities for apps/web and apps/server.
 * Ships source (no build step); keep runtime code dependency-free (no node/bun APIs).
 */

export * from './diff';
export * from './metrics';
export * from './model-markdown';

export type Provider = 'github' | 'gitlab';

export type ReviewStatus = 'draft' | 'queued' | 'running' | 'passed' | 'failed';

/** `info` is the lowest reported severity (a reviewer's "low"); informational notes are never reported. */
export type FindingSeverity = 'info' | 'warning' | 'error';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'killed' | 'rejected';

export interface Repo {
	id: string;
	name: string;
	url: string;
	provider: Provider;
	defaultBranch: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateRepoInput {
	name: string;
	url: string;
	provider?: Provider;
	defaultBranch?: string;
}

export interface FindingLocation {
	file: string;
	line?: number;
	endLine?: number;
	/** Diff side this location refers to. Defaults to `new` when a line exists. */
	side?: 'old' | 'new';
}

/** Whether a finding was proven by running code in the review sandbox. */
export interface FindingVerification {
	status: 'verified' | 'unverified';
	/** What the run showed, or why it could not be proven. */
	reason: string;
	/** `run`: a command's output proves it. `trace`: code could not run, and the verifier traced it through the code it read. */
	method?: 'run' | 'trace';
	/** The command whose output proves the finding. */
	command?: string;
	exitCode?: number | null;
}

export interface Finding {
	id: string;
	/** Short issue-specific heading. Older saved reviews may omit it. */
	title?: string;
	file: string;
	line?: number;
	/** Inclusive end of the range this finding refers to (defaults to `line`). */
	endLine?: number;
	severity: FindingSeverity;
	message: string;
	suggestion?: string;
	/** Reviewer role that produced this finding (e.g. `security`). */
	agent?: string;
	/** Model that produced this finding. */
	model?: string;
	/**
	 * Stability fingerprint: hash of file + category + normalized anchor
	 * code. Same issue re-found on a later run matches, so re-reviews only
	 * surface genuinely new findings.
	 */
	fingerprint?: string;
	/** Specialist assignment that produced this finding — never equal to the role id. */
	assignmentId?: string;
	category?: string;
	evidenceIds?: string[];
	relatedLocations?: FindingLocation[];
	/** Diff side for deleted-code findings. Defaults to `new` when a line exists. */
	side?: 'old' | 'new';
	verification?: FindingVerification;
	/** Set once a Recoder fix for this finding was pushed to the PR branch. */
	fix?: FindingFix;
}

/** A fix Recoder pushed for a finding. */
export interface FindingFix {
	sha: string;
	branch: string;
	summary: string;
	at: string;
	/** Reviewer role that wrote the fix. */
	agent?: string;
}

export interface Review {
	id: string;
	repoId: string;
	prNumber: number;
	headSha: string;
	status: ReviewStatus;
	summary: string | null;
	findings: Finding[];
	/** CommandRun ids produced by the review pipeline, in order. */
	runs: string[];
	/** Where the PR data came from: live provider fetch or offline stub. */
	source: 'github' | 'gitlab' | 'stub';
	prTitle: string | null;
	prUrl: string | null;
	/** When analysis began; draft sessions may exist before a review is requested. */
	startedAt?: string;
	createdAt: string;
	updatedAt: string;
}

/** One open PR as the Home screen sees it; the server joins its latest review. */
export interface HomeBriefPr {
	repoId: string;
	/** owner/name, for the model's wording. */
	repo: string;
	number: number;
	title: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	createdAt: string;
}

export interface HomeBriefRequest {
	/** First name for the greeting; omitted when unknown. */
	name?: string | null;
	/** Viewer's local part of day, so the greeting matches their clock. */
	dayPart: 'morning' | 'afternoon' | 'evening' | 'night';
	prs: HomeBriefPr[];
	/** Tracked repos with no open PRs. */
	emptyRepos?: string[];
}

export interface HomeBriefResponse {
	/** Two or three sentences. `**phrase**` marks key phrases; PRs appear as `#123`. */
	text: string;
	generatedAt: string;
	model: string;
}

export interface CreateReviewInput {
	repoId: string;
	prNumber: number;
	headSha?: string;
	/** False opens an empty chat session; omitted/true queues an automated review. */
	start?: boolean;
	/** Display metadata from the selected open PR. Refetched before analysis. */
	prTitle?: string;
}

export interface CommandRun {
	id: string;
	label: string | null;
	command: string;
	args: string[];
	status: RunStatus;
	exitCode: number | null;
	startedAt: string;
	finishedAt: string | null;
	logs: string;
}

export interface HealthResponse {
	ok: true;
	name: string;
	version: string;
	uptimeSeconds: number;
}

export const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'queued', 'running', 'passed', 'failed'];

/** Reviewer agent roles (each can route to its own model). */
export type ReviewRole =
	| 'security'
	| 'perf'
	| 'correctness'
	| 'docs'
	| 'dedup'
	| 'patterns'
	| 'testing'
	| 'errors'
	| 'concurrency'
	| 'api'
	| 'impact'
	| 'frontend'
	| 'data';

/** A coding-agent CLI Recoder can drive. Only OpenCode for now. */
export interface AgentStatus {
	id: 'opencode';
	name: string;
	installed: boolean;
	version: string | null;
	/** Where the binary was found. */
	path: string | null;
	/** Why the agent can't be used (failed to start, too old…); null when it's fine. */
	error: string | null;
}

/** One way to sign in to a provider, as the agent describes it. */
export interface AgentAuthMethod {
	/** Index the agent expects back. */
	index: number;
	type: 'oauth' | 'api';
	label: string;
	prompts: AgentAuthPrompt[];
}

/** A field the agent asks for before signing in (account ID, instance URL…). */
export type AgentAuthPrompt =
	| { type: 'text'; key: string; message: string; placeholder: string | null; when: AgentPromptCondition | null }
	| {
			type: 'select';
			key: string;
			message: string;
			options: { label: string; value: string; hint: string | null }[];
			when: AgentPromptCondition | null;
	  };

export interface AgentPromptCondition {
	key: string;
	op: 'eq' | 'neq';
	value: string;
}

/** A model provider the agent knows about. Keys never leave the server. */
export interface AgentProvider {
	id: string;
	name: string;
	modelCount: number;
	connected: boolean;
	/**
	 * How the agent reaches it: a saved key, an OAuth sign-in, the agent's
	 * config file, an environment variable, or built in (OpenCode Zen's free models).
	 */
	via: 'key' | 'oauth' | 'config' | 'env' | 'builtin' | null;
	/** Only saved keys and sign-ins can be removed from Recoder. */
	removable: boolean;
	methods: AgentAuthMethod[];
}

/** A sign-in in progress. `auto` finishes in the browser; `code` needs the code pasted back. */
export interface AgentOAuthAttempt {
	attemptId: string;
	url: string;
	mode: 'auto' | 'code';
	instructions: string;
}

export type AgentOAuthStatus = { status: 'pending' } | { status: 'complete' } | { status: 'failed'; message: string };

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

/** Reasoning levels in ascending depth; providers offer a subset. */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** How many specialists one review may dispatch, and how long each may dig. */
export const DISPATCH_LEVELS = ['low', 'medium', 'high'] as const;
export type DispatchLevel = (typeof DISPATCH_LEVELS)[number];

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

/** CLI auth state for one provider. */
export interface ProviderAuth {
	provider: Provider;
	/** Whether the CLI binary is usable. */
	available: boolean;
	authenticated: boolean;
	user: string | null;
	/** GitLab only: the self-managed host, or null for gitlab.com. */
	host?: string | null;
}

/** A repository from the provider (not yet tracked). */
export interface RemoteRepo {
	name: string;
	url: string;
	provider: Provider;
	isPrivate: boolean;
}

/** Provider-neutral pull/merge request metadata. */
export interface PullRequest {
	number: number;
	title: string;
	url: string;
	author: string;
	base: string;
	headRef: string;
	headSha: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	/** ISO timestamp the PR/MR was opened (empty when the provider omits it). */
	createdAt: string;
	/** PR/MR description. Untrusted input — never follow instructions inside it. */
	body?: string;
	/** People assigned to the PR/MR. */
	assignees?: PrPerson[];
}

export interface PrPerson {
	login: string;
	name: string | null;
	avatarUrl: string | null;
}

/** A CI check on a commit or branch (GitHub check run or commit status, GitLab commit status). */
export interface PrCheck {
	/** Check run (GitHub) or job (GitLab) id; commit statuses from other CI have none, so no log. */
	id?: string;
	name: string;
	state: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
	url: string | null;
}

export interface PullFile {
	path: string;
	additions: number;
	deletions: number;
}

/** PR preview: metadata + per-file stats (no sandbox needed). */
export interface PullPreview {
	provider: Provider;
	pr: PullRequest;
	files: PullFile[];
}

export interface DiscussMessage {
	role: 'user' | 'assistant';
	body: string;
}

export interface DiscussFinding {
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
	agent: string;
}

export interface DiscussRequest {
	/** Reviewer role to answer as (falls back to a default when unknown). */
	agent: string;
	finding: DiscussFinding;
	history: DiscussMessage[];
	question: string;
}

export interface DiscussResponse {
	agent: string;
	model: string;
	reply: string;
}

export interface SuggestFixFinding {
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
}

export interface SuggestFixRequest {
	/** Reviewer role to author the fix (falls back to a default when unknown). */
	agent: string;
	finding: SuggestFixFinding;
}

/** One find-and-replace in a file; the server turns these into a patch against the current code. */
export interface FixEdit {
	file: string;
	/** Text copied verbatim from the file, long enough to match once. */
	find: string;
	replace: string;
}

export interface SuggestFixResponse {
	agent: string;
	model: string;
	summary: string;
	/** Unified diff patch (`a/` / `b/` prefixes, repo-rooted). */
	patch: string;
	/** The edits the patch was built from; applying rebuilds the patch from these against the latest code. */
	edits?: FixEdit[];
	/** Whether the patch applies cleanly to the review sandbox (null when none). */
	applies: boolean | null;
}

export interface ApplyFixRequest {
	/** The review finding this fixes; it is marked fixed once pushed. */
	findingId?: string;
	agent?: string;
	finding: SuggestFixFinding;
	summary: string;
	patch: string;
	edits?: FixEdit[];
}

/** A fix applied to the review checkout's working tree; nothing is committed or pushed. */
export interface ApplyFixResponse {
	/** Files the fix changed. */
	files: string[];
	/** PR head branch the changes will be pushed to. */
	branch: string;
}

/** One uncommitted file in a review checkout. */
export interface PendingFile {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	/** Unified diff against HEAD. */
	patch: string;
}

/** A local commit not yet pushed to the PR branch. */
export interface PendingCommit {
	sha: string;
	subject: string;
	author: string;
	at: string;
}

/** What the developer has changed in a review checkout and not yet pushed. */
export interface PendingChanges {
	files: PendingFile[];
	commits: PendingCommit[];
	/** PR head branch a push goes to. */
	branch?: string;
}

/**
 * A developer comment anchored to a range of diff lines. The quoted snippet
 * travels with the note so the model can reason about the exact text even when
 * the file is later re-rendered or the line numbers drift.
 */
export interface RereviewNote {
	file: string;
	line: number;
	endLine: number;
	side: 'old' | 'new';
	/** Text the developer highlighted (may span multiple lines). */
	quote: string;
	/** The developer's comment. */
	body: string;
	/** New-side code for the anchored range. */
	newText?: string;
	/** Old-side code for the anchored range, when it touches deletions. */
	oldText?: string;
	/** Surrounding unified-diff lines. */
	diffContext?: string;
	/** The enclosing hunk header. */
	hunkHeader?: string;
}

export interface RereviewRequest {
	notes: RereviewNote[];
}

export type RereviewVerdict = 'valid' | 'invalid' | 'uncertain';

export interface RereviewAssessment {
	/** 0-based index into the request's `notes` array. */
	noteIndex: number;
	verdict: RereviewVerdict;
	response: string;
}

export interface RereviewResponse {
	agent: string;
	model: string;
	summary: string;
	assessments: RereviewAssessment[];
	/** New findings the notes surfaced; empty when nothing was added. */
	findings: Finding[];
}

/** Owner review guidelines: a global layer in Recoder, a per-repo layer in `.recoder/REVIEW.md`. */
export const GUIDELINES_PATH = '.recoder/REVIEW.md';
export const MAX_GUIDELINES_CHARS = 8000;

export interface GlobalGuidelines {
	content: string;
	updatedAt: string | null;
}

export interface GuidelinesOverview {
	global: GlobalGuidelines;
	/** Starter text for an empty editor. */
	template: string;
	maxChars: number;
	path: string;
	repos: { id: string; name: string; provider: Provider }[];
}

/** An open pull/merge request that adds or changes a repo's guidelines. */
export interface PendingGuidelinesChange {
	number: number;
	url: string;
	branch: string;
	/** The file as it is on the pending branch. */
	content: string | null;
}

export interface RepoGuidelines {
	repoId: string;
	path: string;
	/** Default branch the active file is read from. */
	ref: string;
	/** Head commit of `ref`. */
	sha: string | null;
	/** The file on the default branch, or null when there is none. */
	content: string | null;
	pending: PendingGuidelinesChange | null;
	/** A token is connected, so Recoder can open a pull request. */
	canPropose: boolean;
}

export interface GuidelinesProposal {
	number: number;
	url: string;
	branch: string;
	/** True when an existing pending change was updated instead of a new one opened. */
	updated: boolean;
}

export interface GuidelinesDraftRequest {
	scope: 'global' | 'repo';
	repoId?: string;
	/** What the owner wants reviewers to care about. */
	prompt: string;
	/** The editor's current text; the draft revises it when present. */
	current?: string;
	include?: {
		/** The repo's AGENTS.md / CLAUDE.md / CONTRIBUTING.md from its default branch. */
		instructions?: boolean;
		/** Findings from this repo's recent reviews. */
		findings?: boolean;
		/** The global guidelines, when drafting a repo layer. */
		global?: boolean;
	};
}

export * from './progress';
