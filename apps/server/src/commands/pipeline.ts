import { emptyReviewProgress, parseUnifiedDiff, type CreateReviewInput, type Finding, type Review } from '@recoder/shared';
import { db, reviewDiffs, reviewSandboxes, reviewProgress } from '../store';
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
import { runAdaptiveReview } from '../lib/harness';
import { configForOrchestrator, isReviewConfigured } from '../lib/models';
import { discussionContext, recordChatMessage } from '../lib/review-chat';
import { detectProvider, locateRepo, refspecFor } from '../lib/providers';
import { prepareSandbox, sandboxRevisionDiff } from '../lib/sandbox';
import { tokenEnv } from '../lib/tokens';
import { withReviewMetrics } from '../lib/metrics';

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
	const analysis = new AbortController();

	try {
		if (!repo) throw new Error('repo not found');
		emitReviewEvent(reviewId, { type: 'step', step: 'orchestrator', message: '', data: { orchestratorModel: configForOrchestrator().model } });
		const provider = repo.provider ?? detectProvider(repo.url);
		const env = tokenEnv(provider);
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
			env: tokenEnv(source),
			expectedHeadSha: review.headSha
		}));
		sandboxPath = sandbox.path;
		reviewSandboxes.set(reviewId, sandbox.path);
		if (!baseRef) throw new Error('PR base branch is missing');
		const inspected = await trackReviewTask(reviewId, 'diff', 'Computing local PR diff', () =>
			sandboxRevisionDiff(sandbox.path, baseRef!, tokenEnv(source), source));
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
		const result = await runAdaptiveReview(
			{
				diff: inspected.diff,
				sandboxPath,
				revision: inspected.revision,
				prTitle: review.prTitle,
				prBody,
				signal: analysis.signal
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
				}
			}
		);

		const snapshot = reviewProgress.get(reviewId);
		if (snapshot) {
			reviewProgress.set({
				...snapshot,
				assignments: result.assignments,
				coverage: result.coverage,
				coverageGaps: result.coverageGaps,
				outcome: result.outcome,
				recommendedChecks: result.recommendedChecks,
				planningDegraded: result.planningDegraded,
				candidateCount: result.unconfirmed.length + result.findings.length
			});
		}

		reportReviewTask(reviewId, { id: 'finalize', label: 'Saving results', message: 'Saving review results', status: 'running', kind: 'other' });
		const findings: Finding[] = result.outcome === 'complete' ? result.findings : [...result.findings, ...result.unconfirmed];
		const status = result.outcome === 'complete' ? 'passed' : 'failed';
		touch(reviewId, { status, summary: result.summary, findings });
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
				coverage: result.coverage,
				coverageGaps: result.coverageGaps,
				recommendedChecks: result.recommendedChecks,
				candidateCount: result.findings.length
			}
		});
	} catch (err) {
		analysis.abort();
		const message = err instanceof Error ? err.message : 'pipeline failed';
		try {
			const snapshot = reviewProgress.get(reviewId);
			if (snapshot) reviewProgress.set({ ...snapshot, outcome: 'failed' });
			touch(reviewId, { status: 'failed', summary: message });
		} catch {
			// Review was deleted mid-run (e.g. its session was closed) — nothing to update.
		}
		emitReviewEvent(reviewId, { type: 'error', message });
	}
}
