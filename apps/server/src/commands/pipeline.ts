import {
	emptyReviewProgress,
	settleAssignments,
	parseUnifiedDiff,
	REVIEW_CANCELLED,
	type CreateReviewInput,
	type Finding,
	type Provider,
	type Repo,
	type Review
} from '@recoder/shared';
import {
	closeReviewControl,
	openReviewControl,
	runWithReviewControl,
	type ReviewControl
} from '../review/session/review-control';
import { supersedeWebhookReviews } from '../review/session/supersede';
import { resumableCheckpoint } from '../review/session/review-checkpoint';
import { effectiveReportLowSeverity, effectiveSubagentCap } from '../review/session/review-settings';
import {
	db,
	keepForReplay,
	reviewCheckpoints,
	reviewDiffs,
	reviewSandboxes,
	reviewProgress,
	settlePipelineStreams
} from '../store';
import { emitReviewEvent, reportReviewTask, settleReviewTasks, trackReviewTask } from '../review/session/events';
import { fetchPull, PULL_VIEW_COMMANDS } from '../forge/pull-preview';
import { gatherChangeContext, prsForCommit } from '../forge/pr-context';
import type { GatheredContext } from '../review/pipeline/intent/types';
import { runAdaptiveReview } from '../review/pipeline/harness';
import { configForOrchestrator, configForSubagent, isReviewConfigured, withLockedModels } from '../models/models';
import { ModelBlockedError } from '../review/pipeline/agent-loop';
import { codex } from '../agents/codex/codex';
import { reviewInstructions } from '../review/chat/review-chat';
import { harnessCallbacks } from './pipeline-callbacks';
import { detectProvider, locateRepo, refspecFor } from '../forge/providers';
import { prepareSandbox, sandboxRevisionDiff } from '../sandbox/sandbox';
import { tokenEnv } from '../forge/tokens';
import { withReviewMetrics } from '../models/metrics';

export type QueueReviewInput = CreateReviewInput;

export function touch(reviewId: string, patch: Partial<Review>): Review {
	const current = db.reviews.get(reviewId);

	if (!current) throw new Error(`review ${reviewId} not found`);

	const next: Review = { ...current, ...patch, updatedAt: new Date().toISOString() };

	db.reviews.set(next);

	return next;
}

/**
 * Validate + queue a review, kicking the pipeline in the background.
 * Shared by the REST route and the GitHub webhook. Throws on bad input.
 * A reviewer model is required — stub reviews that finish in seconds with
 * no real findings are worse than refusing outright.
 */
export function queueReview(input: QueueReviewInput, trigger?: Review['trigger']): Review {
	if (!isReviewConfigured()) {
		throw new Error(
			'reviewer not configured: add a reviewer model in settings (or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL)'
		);
	}

	if (trigger === 'webhook') supersedeWebhookReviews(input.repoId, input.prNumber);

	const review = createReviewSession(input, trigger);

	return startReviewSession(review.id);
}

/** Opening a PR creates durable chat state without running models or the pipeline. */
export function createReviewSession(input: CreateReviewInput, trigger?: Review['trigger']): Review {
	const repo = db.repos.get(input.repoId);

	if (!repo) throw new Error('repo not found');

	if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
		throw new Error('invalid prNumber');
	}

	const now = new Date().toISOString();

	const review: Review = {
		id: crypto.randomUUID(),
		repoId: input.repoId,
		prNumber: input.prNumber,
		headSha: input.headSha ?? 'unknown',
		status: 'draft',
		summary: null,
		findings: [],
		runs: [],
		source: repo.provider ?? detectProvider(repo.url),
		prTitle: input.prTitle ?? null,
		prUrl: null,
		...(trigger ? { trigger } : {}),
		...(input.baselineCache === false ? { baselineCache: false as const } : {}),
		createdAt: now,
		updatedAt: now
	};

	db.reviews.set(review);
	reviewProgress.set(emptyReviewProgress(review.id));

	return review;
}

/** Claim the draft synchronously so concurrent prompts cannot launch two pipelines. */
export function startReviewSession(reviewId: string): Review {
	const current = db.reviews.get(reviewId);

	if (!current) throw new Error('review not found');
	if (current.status !== 'draft') throw new Error('This review has already started.');
	if (!isReviewConfigured()) throw new Error('Add a reviewer model in settings before starting the review.');

	const review = touch(reviewId, { status: 'queued', startedAt: new Date().toISOString() });

	emitReviewEvent(reviewId, { type: 'step', step: 'queued', message: '', data: { stage: 'checkout' } });
	void runReviewPipeline(reviewId).catch((err) => console.error('[pipeline] failed', err));

	return review;
}

/**
 * Drive a queued review: fetch PR metadata → prepare the sandbox →
 * run the adaptive harness → persist coverage and findings.
 *
 * Provider fetch failures fail the review. Demo UI lives on explicit
 * frontend demo routes, not as a silent fallback for live reviews.
 */
export async function runReviewPipeline(reviewId: string): Promise<void> {
	return withLockedModels(() => withReviewMetrics(reviewId, 'pipeline', () => runTrackedReviewPipeline(reviewId)));
}

async function runTrackedReviewPipeline(reviewId: string): Promise<void> {
	const initial = db.reviews.get(reviewId);

	if (!initial) return;

	const repo = db.repos.get(initial.repoId);
	let review = touch(reviewId, { status: 'running' });
	let sandboxPath: string | null = null;
	let baseRef: string | undefined;
	let prBody = '';
	let prContext: Promise<GatheredContext | null> = Promise.resolve(null);
	const control = openReviewControl(reviewId);
	const analysis = control.abort;

	try {
		if (!repo) throw new Error('repo not found');

		await assertChatGptSignedIn();

		emitReviewEvent(reviewId, {
			type: 'step',
			step: 'orchestrator',
			message: '',
			data: { orchestratorModel: configForOrchestrator().model }
		});

		const provider = repo.provider ?? detectProvider(repo.url);
		const viewCmd = PULL_VIEW_COMMANDS[provider](review.prNumber);

		emitReviewEvent(reviewId, {
			type: 'step',
			step: 'fetch',
			message: `Fetching PR #${review.prNumber}…`,
			data: { command: viewCmd, stage: 'checkout' }
		});

		const { pr, diff } = await trackReviewTask(reviewId, 'fetch', 'Fetching PR metadata', () =>
			fetchPull(repo, review.prNumber, { metadataOnly: true })
		);

		baseRef = pr.base;
		prBody = pr.body ?? '';

		prContext = contextWithin(repo, review.prNumber, provider, analysis.signal);

		reviewDiffs.set(reviewId, diff);

		review = touch(reviewId, {
			headSha: pr.headSha,
			prTitle: pr.title,
			prUrl: pr.url,
			source: provider
		});

		emitReviewEvent(reviewId, {
			type: 'log',
			step: 'fetch',
			message: `Fetched ${pr.title || `PR #${review.prNumber}`}`
		});

		const source = review.source === 'stub' ? provider : review.source;
		const { slug } = locateRepo(repo.url);
		const { fetchRef, branch } = refspecFor(source, review.prNumber);

		emitReviewEvent(reviewId, {
			type: 'step',
			step: 'sandbox',
			message: 'Preparing sandbox…',
			data: { command: `git fetch origin ${fetchRef.split(':')[0]}`, stage: 'checkout' }
		});

		const sandbox = await trackReviewTask(reviewId, 'sandbox', 'Preparing local checkout', (onProgress) =>
			prepareSandbox({
				onProgress,
				repoSlug: slug,
				prNumber: review.prNumber,
				repoUrl: repo.url,
				fetchRef,
				branch,
				reviewId,
				provider: source,
				env: tokenEnv(source, repo.url),
				expectedHeadSha: review.headSha
			})
		);

		sandboxPath = sandbox.path;
		reviewSandboxes.set(reviewId, sandbox.path);
		if (!baseRef) throw new Error('PR base branch is missing');

		const inspected = await trackReviewTask(reviewId, 'diff', 'Computing local PR diff', () =>
			sandboxRevisionDiff(sandbox.path, baseRef!, tokenEnv(source, repo.url), source)
		);

		reviewDiffs.set(reviewId, inspected.diff);

		emitReviewEvent(reviewId, {
			type: 'log',
			step: 'sandbox',
			message: `Checked out ${inspected.revision.headSha.slice(0, 12)} (merge-base ${inspected.revision.mergeBaseSha.slice(0, 12)})`,
			data: { stage: 'checkout' }
		});

		if (!isReviewConfigured()) {
			throw new Error('reviewer not configured');
		}

		const files = parseUnifiedDiff(inspected.diff);

		emitReviewEvent(reviewId, {
			type: 'step',
			step: 'review',
			message: `Reading ${files.length} changed files…`,
			data: { stage: 'understand' }
		});

		throwIfCancelled(control);

		const { headSha, mergeBaseSha } = inspected.revision;

		const { checkpoint: resume, discarded } = resumableCheckpoint(reviewCheckpoints.get(reviewId), {
			headSha,
			mergeBaseSha
		});

		if (discarded) {
			reviewCheckpoints.delete(reviewId);
			emitReviewEvent(reviewId, { type: 'log', step: 'review', message: discarded });
		}

		const result = await runWithReviewControl(control, async () =>
			runAdaptiveReview(
				{
					diff: inspected.diff,
					sandboxPath,
					repoId: review.repoId,
					revision: inspected.revision,
					prTitle: review.prTitle,
					prBody,
					context: await prContext,
					prsForCommit: (sha, signal) => prsForCommit(repo, provider, sha, signal),
					instructions: reviewInstructions(reviewId, initial.startedAt),
					signal: analysis.signal,
					subagentCap: effectiveSubagentCap(),
					reportLowSeverity: effectiveReportLowSeverity(),
					baselineCache: review.baselineCache,
					resume
				},
				harnessCallbacks(reviewId, { headSha, mergeBaseSha })
			)
		);

		throwIfCancelled(control);

		const snapshot = reviewProgress.get(reviewId);

		if (snapshot) {
			reviewProgress.set({
				...snapshot,
				assignments: result.assignments,
				coverage: result.coverage,
				coverageGaps: result.coverageGaps,
				outcome: result.outcome,
				failure: result.failure,
				recommendedChecks: result.recommendedChecks,
				candidateCount: result.funnel?.raised ?? result.findings.length
			});
		}

		reportReviewTask(reviewId, {
			id: 'finalize',
			label: 'Saving results',
			message: 'Saving review results',
			status: 'running',
			kind: 'other'
		});

		const findings: Finding[] =
			result.outcome === 'complete' ? result.findings : [...result.findings, ...result.unconfirmed];

		const status = result.outcome === 'complete' ? 'passed' : 'failed';

		touch(reviewId, {
			status,
			summary: result.summary,
			findings,
			unconfirmed: result.outcome === 'complete' ? result.unconfirmed : [],
			funnel: result.funnel
		});

		if (status === 'passed') keepForReplay(reviewId);

		reportReviewTask(reviewId, {
			id: 'finalize',
			label: 'Saving results',
			message: result.outcome === 'complete' ? 'Review complete' : 'Review failed',
			status: result.outcome === 'complete' ? 'done' : 'error',
			kind: 'other'
		});

		settleReviewTasks(reviewId, result.outcome === 'complete' ? null : result.summary);

		emitReviewEvent(reviewId, {
			type: result.outcome === 'complete' ? 'done' : 'error',
			message: result.summary,
			data: {
				outcome: result.outcome,
				...(result.failure ? { failure: result.failure } : {}),
				coverage: result.coverage,
				coverageGaps: result.coverageGaps,
				recommendedChecks: result.recommendedChecks,
				candidateCount: result.findings.length
			}
		});
	} catch (err) {
		const cancelled = analysis.signal.aborted;

		analysis.abort();

		const message = cancelled ? cancelReason(analysis.signal) : err instanceof Error ? err.message : 'pipeline failed';
		const failure = !cancelled && err instanceof ModelBlockedError ? err.failure : undefined;

		markFailed(reviewId, message, failure);

		emitReviewEvent(reviewId, { type: 'error', message, data: { paused: false, ...(failure ? { failure } : {}) } });
	} finally {
		closeReviewControl(reviewId, control);
		settleRun(reviewId);
	}
}

/** Why the review was cancelled, as `ReviewControl.cancel` recorded it. */
function cancelReason(signal: AbortSignal): string {
	return signal.reason instanceof Error ? signal.reason.message : REVIEW_CANCELLED;
}

/** Planning and the correctness pass always run, so a missing ChatGPT sign-in fails now, not after a long checkout. */
async function assertChatGptSignedIn(): Promise<void> {
	const usesCodex = [configForOrchestrator(), configForSubagent()].some((config) => config.provider === 'codex');

	if (usesCodex && !(await codex.signedIn())) {
		throw new ModelBlockedError({ reason: 'Sign in to ChatGPT to run this review.', signIn: true });
	}
}

/**
 * Why the PR exists (description, issues, discussion, stack, past reviews),
 * fetched while the sandbox clones. Best effort: after 30s the requests are
 * aborted and the context is empty, so a slow host API can't hold the review
 * once the checkout is ready.
 */
function contextWithin(
	repo: Repo,
	prNumber: number,
	provider: Provider,
	signal: AbortSignal
): Promise<GatheredContext> {
	return gatherChangeContext(repo, prNumber, provider, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
}

/** Record a failed run and close its open work. A review deleted mid-run (its session closed) has nothing left to update. */
function markFailed(reviewId: string, message: string, failure: ModelBlockedError['failure'] | undefined): void {
	try {
		const snapshot = reviewProgress.get(reviewId);

		if (snapshot)
			reviewProgress.set({
				...snapshot,
				outcome: 'failed',
				assignments: settleAssignments(snapshot.assignments ?? [], message),
				...(failure ? { failure } : {})
			});
		settleReviewTasks(reviewId, message);
		touch(reviewId, { status: 'failed', summary: message });
	} catch {}
}

/**
 * Close out a run, however it ended: settle the streamed messages and
 * reasoning (skipped when the review was deleted mid-run), then write the
 * final state to SQLite now rather than on the write-behind timer.
 */
function settleRun(reviewId: string): void {
	try {
		const settled = settlePipelineStreams(reviewId);

		if (settled)
			emitReviewEvent(reviewId, {
				type: 'log',
				step: 'review',
				message: '',
				data: { settled: { messages: settled.messages, reasoning: settled.reasoning } }
			});
	} catch {}

	reviewProgress.flush();
}

function throwIfCancelled(control: ReviewControl): void {
	if (control.abort.signal.aborted) throw new Error(REVIEW_CANCELLED);
}
