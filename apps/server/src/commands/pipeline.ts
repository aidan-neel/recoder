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
import { resumableCheckpoint } from '../review/session/review-checkpoint';
import {
	effectiveReportLowSeverity,
	effectiveSubagentCap,
	effectiveTokenBudget
} from '../review/session/review-settings';
import {
	db,
	keepForReplay,
	reviewCheckpoints,
	reviewDiffs,
	reviewSandboxes,
	reviewProgress,
	settlePipelineStreams
} from '../store';
import {
	flushReviewEvents,
	emitReviewEvent,
	reportReviewTask,
	settleReviewTasks,
	trackReviewTask
} from '../review/session/events';
import { fetchPull, PULL_VIEW_COMMANDS } from '../forge/pull-preview';
import { settlePullComment, trackPullComment } from '../forge/publish/pull-comment';
import { gatherChangeContext, prsForCommit } from '../forge/pr-context';
import type { GatheredContext } from '../review/pipeline/intent/types';
import { runAdaptiveReview } from '../review/pipeline/harness';
import { configForOrchestrator, configForSubagent, isReviewConfigured, withLockedModels } from '../models/models';
import { ModelBlockedError } from '../review/pipeline/agent-loop';
import { codex } from '../agents/codex/codex';
import { reviewInstructions } from '../review/chat/review-chat';
import { recordBrief } from '../review/chat/chat-replies';
import { harnessCallbacks } from './pipeline-callbacks';
import { detectProvider, locateRepo, refspecFor } from '../forge/providers';
import { prepareSandbox, sandboxRevisionDiff } from '../sandbox/sandbox';
import { tokenEnv } from '../forge/tokens';
import { recordTokenBudget, withReviewMetrics } from '../models/metrics';

export type QueueReviewInput = CreateReviewInput;

export async function touch(reviewId: string, patch: Partial<Review>): Promise<Review> {
	const next = await db.reviews.update(reviewId, (current) => {
		if (!current) throw new Error(`review ${reviewId} not found`);

		return { ...current, ...patch, updatedAt: new Date().toISOString() };
	});

	if (!next) throw new Error(`review ${reviewId} not found`);

	return next;
}
/**
 * Validate + queue a review, kicking the pipeline in the background. A brief
 * in `instructions` is recorded first, so the review runs with it.
 * Throws on bad input.
 * A reviewer model is required — stub reviews that finish in seconds with
 * no real findings are worse than refusing outright.
 */
export async function queueReview(input: QueueReviewInput): Promise<Review> {
	if (!isReviewConfigured()) {
		throw new Error(
			'reviewer not configured: add a reviewer model in settings (or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL)'
		);
	}

	const review = await createReviewSession(input);

	await recordBrief(review.id, input.instructions);

	return await startReviewSession(review.id);
}
/** Opening a PR creates durable chat state without running models or the pipeline. */
export async function createReviewSession(input: CreateReviewInput, trigger?: Review['trigger']): Promise<Review> {
	const repo = await db.repos.get(input.repoId);

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
		...(input.postComment ? { pullComment: { state: 'posting' as const, updatedAt: now } } : {}),
		createdAt: now,
		updatedAt: now
	};

	await db.reviews.set(review);
	await reviewProgress.set(emptyReviewProgress(review.id));

	return review;
}
/** Claim the draft atomically so concurrent prompts cannot launch two pipelines. */
export async function startReviewSession(reviewId: string): Promise<Review> {
	const review = await db.reviews.update(reviewId, (current) => {
		if (!current) throw new Error('review not found');
		if (current.status !== 'draft') throw new Error('This review has already started.');
		if (!isReviewConfigured()) throw new Error('Add a reviewer model in settings before starting the review.');

		return { ...current, status: 'queued', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	});

	if (!review) throw new Error('review not found');

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
	return withLockedModels(
		async () => await withReviewMetrics(reviewId, 'pipeline', () => runTrackedReviewPipeline(reviewId))
	);
}

async function runTrackedReviewPipeline(reviewId: string): Promise<void> {
	const initial = await db.reviews.get(reviewId);

	if (!initial) return;

	const repo = await db.repos.get(initial.repoId);
	let review = await touch(reviewId, { status: 'running' });
	let sandboxPath: string | null = null;
	let baseRef: string | undefined;
	let prBody = '';
	let prContext: Promise<GatheredContext | null> = Promise.resolve(null);
	const control = openReviewControl(reviewId);
	const analysis = control.abort;

	await trackPullComment(reviewId);

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
		await reviewDiffs.set(reviewId, diff);

		review = await touch(reviewId, {
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

		await reviewDiffs.set(reviewId, inspected.diff);

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

		const { checkpoint: resume, discarded } = resumableCheckpoint(await reviewCheckpoints.get(reviewId), {
			headSha,
			mergeBaseSha
		});

		if (discarded) {
			await reviewCheckpoints.delete(reviewId);
			emitReviewEvent(reviewId, { type: 'log', step: 'review', message: discarded });
		}

		const tokenBudget = effectiveTokenBudget();

		recordTokenBudget(tokenBudget);

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
					instructions: await reviewInstructions(reviewId, initial.startedAt),
					signal: analysis.signal,
					subagentCap: effectiveSubagentCap(),
					tokenBudget,
					reportLowSeverity: effectiveReportLowSeverity(),
					baselineCache: review.baselineCache,
					resume
				},
				harnessCallbacks(reviewId, { headSha, mergeBaseSha })
			)
		);

		throwIfCancelled(control);

		await flushReviewEvents(reviewId);

		await reviewProgress.update(reviewId, (snapshot) =>
			snapshot
				? {
						...snapshot,
						assignments: result.assignments,
						coverage: result.coverage,
						coverageGaps: result.coverageGaps,
						outcome: result.outcome,
						failure: result.failure,
						recommendedChecks: result.recommendedChecks,
						candidateCount: result.funnel?.raised ?? result.findings.length
					}
				: undefined
		);

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

		await touch(reviewId, {
			status,
			summary: result.summary,
			findings,
			unconfirmed: result.outcome === 'complete' ? result.unconfirmed : [],
			funnel: result.funnel,
			context: result.context,
			...(result.obligations ? { obligations: result.obligations } : {}),
			...(result.questions ? { questions: result.questions } : {})
		});

		if (status === 'passed') await keepForReplay(reviewId);

		reportReviewTask(reviewId, {
			id: 'finalize',
			label: 'Saving results',
			message: result.outcome === 'complete' ? 'Review complete' : 'Review failed',
			status: result.outcome === 'complete' ? 'done' : 'error',
			kind: 'other'
		});

		await settleReviewTasks(reviewId, result.outcome === 'complete' ? null : result.summary);

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

		await markFailed(reviewId, message, failure);
		emitReviewEvent(reviewId, { type: 'error', message, data: { paused: false, ...(failure ? { failure } : {}) } });
	} finally {
		closeReviewControl(reviewId, control);
		await settleRun(reviewId);
		await settlePullComment(reviewId);
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
	return gatherChangeContext(repo, prNumber, provider, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
}

/** Record a failed run and close its open work. A review deleted mid-run (its session closed) has nothing left to update. */
async function markFailed(
	reviewId: string,
	message: string,
	failure: ModelBlockedError['failure'] | undefined
): Promise<void> {
	if (!(await db.reviews.get(reviewId))) return;
	await flushReviewEvents(reviewId);

	await reviewProgress.update(reviewId, (snapshot) =>
		snapshot
			? {
					...snapshot,
					outcome: 'failed',
					assignments: settleAssignments(snapshot.assignments ?? [], message),
					...(failure ? { failure } : {})
				}
			: undefined
	);

	await settleReviewTasks(reviewId, message);
	await touch(reviewId, { status: 'failed', summary: message });
}

/**
 * Close out a run, however it ended: settle the streamed messages and
 * reasoning (skipped when the review was deleted mid-run), then write the
 * final state to SQLite now rather than on the write-behind timer.
 */
async function settleRun(reviewId: string): Promise<void> {
	if (!(await db.reviews.get(reviewId))) return;

	const settled = await settlePipelineStreams(reviewId);

	if (settled)
		emitReviewEvent(reviewId, {
			type: 'log',
			step: 'review',
			message: '',
			data: { settled: { messages: settled.messages, reasoning: settled.reasoning } }
		});

	await flushReviewEvents(reviewId);
	await reviewProgress.flush();
}

function throwIfCancelled(control: ReviewControl): void {
	if (control.abort.signal.aborted) throw new Error(REVIEW_CANCELLED);
}
