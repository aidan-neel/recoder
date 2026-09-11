/**
 * @recoder/shared — contract + portable utilities for apps/web and apps/server.
 * Ships source (no build step); keep runtime code dependency-free (no node/bun APIs).
 */

export * from './diff';
export * from './metrics';

export type Provider = 'github' | 'gitlab';

export type ReviewStatus = 'queued' | 'running' | 'passed' | 'failed';

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

export interface Finding {
	id: string;
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
	createdAt: string;
	updatedAt: string;
}

export interface CreateReviewInput {
	repoId: string;
	prNumber: number;
	headSha?: string;
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

export const REVIEW_STATUSES: ReviewStatus[] = ['queued', 'running', 'passed', 'failed'];

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
	| 'api';

/** A named model entry in the registry (keys never leave the server). */
export interface ModelEntry {
	provider?: 'openai-compatible' | 'codex';
	id: string;
	label: string;
	model: string;
	baseUrl: string | null;
	apiKeyPreview: string | null;
	/** Reasoning levels this model accepts, when the provider reports them. */
	efforts?: ReasoningEffort[];
}

export interface ModelEntryPatch {
	provider?: 'openai-compatible' | 'codex';
	id?: string;
	label: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
	efforts?: ReasoningEffort[];
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** Reviewer model configuration (keys are never exposed). */
export interface ModelSettings {
	configured: boolean;
	baseUrl: string;
	model: string;
	apiKeyPreview: string | null;
	sharedModelId: string | null;
	models: ModelEntry[];
	roles: Record<ReviewRole, string | null>;
	/** Explicit per-role overrides; absent roles retain provider defaults (Codex: medium). */
	roleEfforts?: Partial<Record<ReviewRole, ReasoningEffort>>;
	limits: { maxFiles: number; maxDiffChars: number; maxFileChars: number };
}

export interface ModelSettingsPatch {
	baseUrl?: string;
	apiKey?: string;
	models?: ModelEntryPatch[];
	sharedModelId?: string | null;
	roles?: Partial<Record<ReviewRole, string>>;
	/** Merged by role; omitted roles keep their saved effort. */
	roleEfforts?: Partial<Record<ReviewRole, ReasoningEffort>>;
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
}

/** CLI auth state for one provider. */
export interface ProviderAuth {
	provider: Provider;
	/** Whether the CLI binary is usable. */
	available: boolean;
	authenticated: boolean;
	user: string | null;
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

export interface SuggestFixResponse {
	agent: string;
	model: string;
	summary: string;
	/** Unified diff patch (`a/` / `b/` prefixes, repo-rooted). */
	patch: string;
	/** Whether the patch applies cleanly to the review sandbox (null when none). */
	applies: boolean | null;
}

export interface ApplyFixRequest {
	finding: SuggestFixFinding;
	summary: string;
	patch: string;
}

export interface ApplyFixResponse {
	sha: string;
	/** PR head branch the commit was pushed to. */
	branch: string;
	pushed: boolean;
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

export * from './progress';
