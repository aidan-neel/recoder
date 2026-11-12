import { settleAssignments, parseUnifiedDiff, REVIEW_CANCELLED, type Provider, type Repo } from '@recoder/shared';
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
import { db, reviewCheckpoints, reviewDiffs, reviewSandboxes, reviewProgress } from '../store';
import { flushReviewEvents, emitReviewEvent, settleReviewTasks, trackReviewTask } from '../review/session/events';
import { fetchPull, PULL_VIEW_COMMANDS } from '../forge/pull-preview';
import { settlePullComment, trackPullComment, stopPullCommentTracking } from '../forge/publish/pull-comment';
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
import { recordTokenBudget, withReviewMetrics } from '../models/metrics';
import { isRecoverableExit } from '../review/runtime/execution';
import { storageTransaction } from '../storage/backend';
import { finalizeReview, settleRun } from './finalize-review';
import { coordinator } from '../storage/backend';

export { queueReview, createReviewSession, startReviewSession, touch } from './review-session';

import { touch } from './review-session';

/**
 * Drive a queued review: fetch PR metadata → prepare the sandbox →
 * run the adaptive harness → persist coverage and findings.
 *
 * Provider fetch failures fail the review. Demo UI lives on explicit
 * frontend demo routes, not as a silent fallback for live reviews.
 */
export async function runReviewPipeline(reviewId: string, signal?: AbortSignal): Promise<void> {
	return withLockedModels(
		async () => await withReviewMetrics(reviewId, 'pipeline', () => runTrackedReviewPipeline(reviewId, signal))
	);
}

async function runTrackedReviewPipeline(reviewId: string, signal?: AbortSignal): Promise<void> {
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
	const interrupted = () => control.abort.abort(signal?.reason);
	let abandoned = false;

	if (signal?.aborted) interrupted();
	else signal?.addEventListener('abort', interrupted, { once: true });

	try {
		if (coordinator) {
			const lease = (await import('../review/runtime/ownership')).currentLease();

			if (lease && (await coordinator.state(lease)) === 'paused') control.pause();
		}

		await trackPullComment(reviewId);
		if (signal?.aborted) throw signal.reason;
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

		await finalizeReview(reviewId, result);
	} catch (err) {
		if (isRecoverableExit(err) || isRecoverableExit(signal?.reason)) {
			abandoned = true;
			throw err;
		}

		const cancelled = analysis.signal.aborted;

		analysis.abort();

		const message = cancelled ? cancelReason(analysis.signal) : err instanceof Error ? err.message : 'pipeline failed';
		const failure = !cancelled && err instanceof ModelBlockedError ? err.failure : undefined;

		await flushReviewEvents(reviewId);

		await storageTransaction(async () => {
			await markFailed(reviewId, message, failure);
			emitReviewEvent(reviewId, { type: 'error', message, data: { paused: false, ...(failure ? { failure } : {}) } });
			await settleRun(reviewId);
			await flushReviewEvents(reviewId);
		});
	} finally {
		if (abandoned || isRecoverableExit(signal?.reason)) stopPullCommentTracking(reviewId);
		signal?.removeEventListener('abort', interrupted);
		closeReviewControl(reviewId, control);

		if (!abandoned && !isRecoverableExit(signal?.reason)) {
			await settleRun(reviewId);
			await settlePullComment(reviewId);
		}
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

function throwIfCancelled(control: ReviewControl): void {
	if (control.abort.signal.aborted) throw new Error(REVIEW_CANCELLED);
}
