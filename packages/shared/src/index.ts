/**
 * @recoder/shared — contract + portable utilities for apps/web and apps/server.
 * Ships source (no build step); keep runtime code dependency-free (no node/bun APIs).
 */

export * from './diff';

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
export type ReviewRole = 'security' | 'perf' | 'correctness' | 'docs';

/** A named model entry in the registry (keys never leave the server). */
export interface ModelEntry {
	id: string;
	label: string;
	model: string;
	baseUrl: string | null;
	apiKeyPreview: string | null;
}

export interface ModelEntryPatch {
	id?: string;
	label: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
}

/** Reviewer model configuration (keys are never exposed). */
export interface ModelSettings {
	configured: boolean;
	baseUrl: string;
	model: string;
	apiKeyPreview: string | null;
	sharedModelId: string | null;
	models: ModelEntry[];
	roles: Record<ReviewRole, string | null>;
	limits: { maxFiles: number; maxDiffChars: number; maxFileChars: number };
}

export interface ModelSettingsPatch {
	baseUrl?: string;
	apiKey?: string;
	models?: ModelEntryPatch[];
	sharedModelId?: string | null;
	roles?: Partial<Record<ReviewRole, string>>;
	maxFiles?: number;
	maxDiffChars?: number;
	maxFileChars?: number;
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
