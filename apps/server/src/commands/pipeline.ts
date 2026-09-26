import { emptyReviewProgress, parseUnifiedDiff, type CreateReviewInput, type Finding, type Review } from '@recoder/shared';
import { closeReviewControl, openReviewControl, runWithReviewControl, type ReviewControl } from '../lib/review-control';
import { db, reviewCheckpoints, reviewDiffs, reviewSandboxes, reviewProgress, settlePipelineStreams } from '../store';
import {
	emitReviewEvent,
	reportReviewAssignment,
	reportReviewCoverage,
	reportReviewPlan,
	reportReviewReasoning,
	reportReviewTask,
	reportReviewTool,
	trackReviewTask
} from '../lib/events';
import { fetchPullRequest } from '../lib/gh';
import { fetchMergeRequest } from '../lib/glab';
import { fetchPrContext } from '../lib/pr-context';
import { runAdaptiveReview } from '../lib/harness';
import { configForOrchestrator, configForRole, isReviewConfigured } from '../lib/models';
import { AuthConfigError } from '../lib/agent-loop';
import { codex } from '../lib/codex';
import { discussionContext, recordChatMessage } from '../lib/review-chat';
import { detectProvider, locateRepo, refspecFor } from '../lib/providers';
import { prepareSandbox, sandboxRevisionDiff } from '../lib/sandbox';
import { tokenEnv } from '../lib/tokens';
import { withReviewMetrics } from '../lib/metrics';
import { carryFixes } from '../lib/finding-fixes';

export type QueueReviewInput = CreateReviewInput;

function touch(reviewId: string, patch: Partial<Review>): Review {
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
export function queueReview(input: QueueReviewInput): Review {
	if (!isReviewConfigured()) {
		throw new Error(
			'reviewer not configured: add a reviewer model in settings (or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL)'
		);
	}
	const review = createReviewSession(input);
	return startReviewSession(review.id);
}

/** Opening a PR creates durable chat state without running models or the pipeline. */
export function createReviewSession(input: CreateReviewInput): Review {
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
 * Continue a failed review where it stopped. Planning and finished specialists
 * are kept from the last checkpoint; without one (or when the PR moved on)
 * the review runs again from the start in the same session.
 */
export function continueReviewSession(reviewId: string): Review {
	const current = db.reviews.get(reviewId);
	if (!current) throw new Error('review not found');
	if (current.status !== 'failed') throw new Error('Only an incomplete review can be continued.');
	if (!isReviewConfigured()) throw new Error('Add a reviewer model in settings before continuing the review.');
	const review = touch(reviewId, { status: 'queued' });
	emitReviewEvent(reviewId, { type: 'step', step: 'queued', message: '', data: { stage: 'checkout', outcome: null, failure: null } });
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
	return withReviewMetrics(reviewId, 'pipeline', () => runTrackedReviewPipeline(reviewId));
}

async function runTrackedReviewPipeline(reviewId: string): Promise<void> {
	const initial = db.reviews.get(reviewId);
	if (!initial) return;
	const repo = db.repos.get(initial.repoId);
	let review = touch(reviewId, { status: 'running' });
	let sandboxPath: string | null = null;
	let baseRef: string | undefined;
	let prBody = '';
	let prContext: Promise<string> = Promise.resolve('');
	const control = openReviewControl(reviewId);
	const analysis = control.abort;

	try {
		if (!repo) throw new Error('repo not found');
		// Planning and the correctness pass always run: fail now, not after a long checkout.
		if ([configForOrchestrator(), configForRole('correctness')].some((config) => config.provider === 'codex') && !(await codex.signedIn())) {
			throw new AuthConfigError({ reason: 'Sign in to ChatGPT to run this review.', signIn: true });
		}
		emitReviewEvent(reviewId, { type: 'step', step: 'orchestrator', message: '', data: { orchestratorModel: configForOrchestrator().model } });
		const provider = repo.provider ?? detectProvider(repo.url);
		const env = tokenEnv(provider, repo.url);
		const viewCmd =
			provider === 'gitlab'
				? `glab mr view ${review.prNumber}`
				: `gh pr view ${review.prNumber}`;
		emitReviewEvent(reviewId, {
			type: 'step',
			step: 'fetch',
			message: `Fetching PR #${review.prNumber}…`,
			data: { command: viewCmd, stage: 'checkout' }
		});
		const { pr, diff } = await trackReviewTask(reviewId, 'fetch', 'Fetching PR metadata', async () =>
			provider === 'gitlab'
				? await fetchMergeRequest(repo.url, review.prNumber, { env })
				: await fetchPullRequest(repo.url, review.prNumber, { env, metadataOnly: true }));
		baseRef = pr.base;
		prBody = pr.body ?? '';
		// People and linked issues for the planner; fetched while the sandbox clones.
		prContext = fetchPrContext(repo, review.prNumber, provider);
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
		const sandbox = await trackReviewTask(reviewId, 'sandbox', 'Preparing local checkout', (onProgress) => prepareSandbox({
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
		}));
		sandboxPath = sandbox.path;
		reviewSandboxes.set(reviewId, sandbox.path);
		if (!baseRef) throw new Error('PR base branch is missing');
		const inspected = await trackReviewTask(reviewId, 'diff', 'Computing local PR diff', () =>
			sandboxRevisionDiff(sandbox.path, baseRef!, tokenEnv(source, repo.url), source));
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
			message: `Planning a review of ${files.length} files…`,
			data: { stage: 'understand' }
		});
		throwIfCancelled(control);
		const { headSha, mergeBaseSha } = inspected.revision;
		const saved = reviewCheckpoints.get(reviewId);
		const resume = saved?.headSha === headSha && saved.mergeBaseSha === mergeBaseSha ? saved : null;
		if (saved && !resume) {
			reviewCheckpoints.delete(reviewId);
			emitReviewEvent(reviewId, { type: 'log', step: 'review', message: 'The pull request changed since the last run, so the review starts over.' });
		}
		const result = await runWithReviewControl(control, async () => runAdaptiveReview(
			{
				diff: inspected.diff,
				sandboxPath,
				revision: inspected.revision,
				prTitle: review.prTitle,
				prBody,
				prContext: await prContext,
				signal: analysis.signal,
				resume
			},
			{
				onTask: (task) => reportReviewTask(reviewId, task),
				onMessage: (message) => recordChatMessage(reviewId, { ...message, from: 'assistant', at: new Date().toISOString() }),
				getDiscussion: (assignmentId) => [
					discussionContext(reviewId),
					assignmentId && assignmentId !== '__pipeline' ? discussionContext(reviewId, assignmentId) : ''
				].filter(Boolean).join('\n\n'),
				onLog: (message, meta) =>
					emitReviewEvent(reviewId, {
						type: 'log',
						step: meta?.assignmentId ? `assignment:${meta.assignmentId}` : 'review',
						message,
						data: { agent: meta?.role, assignmentId: meta?.assignmentId }
					}),
				onPlan: (data) => reportReviewPlan(reviewId, data),
				onAssignment: (assignment) => reportReviewAssignment(reviewId, assignment),
				onCoverage: (coverage, gaps) => reportReviewCoverage(reviewId, coverage, gaps),
				onBudget: (budget) => {
					const snapshot = reviewProgress.get(reviewId);
					if (snapshot) reviewProgress.set({ ...snapshot, budget });
				},
				onReasoning: (reasoning) => reportReviewReasoning(reviewId, reasoning),
				onTool: (tool) => reportReviewTool(reviewId, tool),
				onCandidates: (count) => {
					const snapshot = reviewProgress.get(reviewId);
					if (snapshot) reviewProgress.set({ ...snapshot, candidateCount: count });
					emitReviewEvent(reviewId, {
						type: 'finding',
						message: `${count} candidate finding${count === 1 ? '' : 's'}`,
						data: { candidateCount: count }
					});
				},
				onGuidelines: (guidelines) => {
					const sources = guidelines.layers.map((layer) => layer.source === 'global' ? 'global' : layer.path).join(' + ');
					emitReviewEvent(reviewId, { type: 'step', step: 'review', message: `Following review guidelines (${sources})`, data: { guidelines } });
				},
				onStage: (stage) => {
					emitReviewEvent(reviewId, { type: 'step', step: stage, message: '', data: { stage } });
				},
				onCheckpoint: (checkpoint) => reviewCheckpoints.set({ ...checkpoint, id: reviewId, headSha, mergeBaseSha })
			}
		));
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
				planningDegraded: result.planningDegraded,
				candidateCount: result.unconfirmed.length + result.findings.length
			});
		}

		reportReviewTask(reviewId, { id: 'finalize', label: 'Saving results', message: 'Saving review results', status: 'running', kind: 'other' });
		const findings: Finding[] = result.outcome === 'complete' ? result.findings : [...result.findings, ...result.unconfirmed];
		const status = result.outcome === 'complete' ? 'passed' : 'failed';
		touch(reviewId, { status, summary: result.summary, findings: carryFixes(db.reviews.get(reviewId)?.findings ?? [], findings) });
		if (status === 'passed') reviewCheckpoints.delete(reviewId);
		reportReviewTask(reviewId, {
			id: 'finalize',
			label: 'Saving results',
			message: result.outcome === 'complete' ? 'Review complete' : 'Review incomplete',
			status: result.outcome === 'complete' ? 'done' : 'error',
			kind: 'other'
		});
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
		const message = cancelled ? 'Review cancelled.' : err instanceof Error ? err.message : 'pipeline failed';
		const failure = !cancelled && err instanceof AuthConfigError ? err.failure : undefined;
		try {
			const snapshot = reviewProgress.get(reviewId);
			if (snapshot) reviewProgress.set({ ...snapshot, outcome: 'failed', ...(failure ? { failure } : {}) });
			touch(reviewId, { status: 'failed', summary: message });
		} catch {
			// Review was deleted mid-run (e.g. its session was closed) — nothing to update.
		}
		emitReviewEvent(reviewId, { type: 'error', message, data: { paused: false, ...(failure ? { failure } : {}) } });
	} finally {
		closeReviewControl(reviewId, control);
		try {
			const settled = settlePipelineStreams(reviewId);
			if (settled) emitReviewEvent(reviewId, { type: 'log', step: 'review', message: '', data: { settled: { messages: settled.messages, reasoning: settled.reasoning } } });
		} catch { /* Review deleted mid-run. */ }
	}
}

function throwIfCancelled(control: ReviewControl): void {
	if (control.abort.signal.aborted) throw new Error('Review cancelled.');
}
