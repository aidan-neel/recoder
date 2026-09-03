import { parseUnifiedDiff, type Finding, type Review } from '@recoder/shared';
import { db, reviewDiffs } from '../store';
import { emitReviewEvent } from '../lib/events';
import { fetchPullRequest, GhError } from '../lib/gh';
import { fetchMergeRequest } from '../lib/glab';
import { runAllRoles } from '../lib/harness';
import { isReviewConfigured } from '../lib/models';
import { detectProvider, locateRepo, refspecFor } from '../lib/providers';
import { prepareSandbox } from '../lib/sandbox';
import { tokenEnv } from '../lib/tokens';
import { demoReviewSteps } from './registry';
import { runCommand } from './runner';

export interface QueueReviewInput {
	repoId: string;
	prNumber: number;
	headSha?: string;
}

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
 */
export function queueReview(input: QueueReviewInput): Review {
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
		status: 'queued',
		summary: null,
		findings: [],
		runs: [],
		source: 'stub',
		prTitle: null,
		prUrl: null,
		createdAt: now,
		updatedAt: now
	};
	db.reviews.set(review);
	// Run the pipeline in the background; the client polls GET /api/reviews/:id.
	void runReviewPipeline(review.id).catch((err) => console.error('[pipeline] failed', err));
	return review;
}

/**
 * Drive a queued review: fetch the PR (gh or stub) → prepare the sandbox →
 * run reviewer command steps → mark passed/failed.
 *
 * No reviewer agent executes yet: after fetch + sandbox, the demo `echo`
 * steps stand in. Sandbox preparation is required in github mode and skipped
 * in stub mode (gh unavailable/unauthenticated).
 */
export async function runReviewPipeline(reviewId: string): Promise<void> {
	const initial = db.reviews.get(reviewId);
	if (!initial) return;
	const repo = db.repos.get(initial.repoId);
	let review = touch(reviewId, { status: 'running' });
	let sandboxPath: string | null = null;

	try {
		// 1. Fetch the PR. Offline provider CLI → stay in stub mode and continue.
		emitReviewEvent(reviewId, { type: 'step', step: 'fetch', message: 'Fetching PR…' });
		try {
			if (!repo) throw new Error('repo not found');
			const provider = repo.provider ?? detectProvider(repo.url);
			const env = tokenEnv(provider);
			const { pr, diff } =
				provider === 'gitlab'
					? await fetchMergeRequest(repo.url, review.prNumber, { env })
					: await fetchPullRequest(repo.url, review.prNumber, { env });
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
				message: `Fetched ${pr.title || `PR #${pr.number}`}`
			});
		} catch (err) {
			if (err instanceof GhError && (err.kind === 'unavailable' || err.kind === 'auth')) {
				console.warn(`[pipeline] provider CLI unavailable (${err.kind}); continuing in stub mode`);
				emitReviewEvent(reviewId, {
					type: 'log',
					step: 'fetch',
					message: 'Provider CLI unavailable — stub mode'
				});
			} else {
				throw err;
			}
		}

		// 2. Sandbox checkout (provider mode only).
		if (review.source !== 'stub' && repo) {
			emitReviewEvent(reviewId, { type: 'step', step: 'sandbox', message: 'Preparing sandbox…' });
			const { slug } = locateRepo(repo.url);
			const { fetchRef, branch } = refspecFor(review.source, review.prNumber);
			const sandbox = await prepareSandbox({
				repoSlug: slug,
				prNumber: review.prNumber,
				repoUrl: repo.url,
				fetchRef,
				branch
			});
			sandboxPath = sandbox.path;
			emitReviewEvent(reviewId, { type: 'log', step: 'sandbox', message: `Checked out ${sandbox.headSha.slice(0, 12)}` });
		}

		// 3. Review: real harness when a model is configured, demo echo otherwise.
		let findings: Finding[];
		let summary: string;
		if (isReviewConfigured() && reviewDiffs.has(reviewId)) {
			const diff = reviewDiffs.get(reviewId) ?? '';
			const files = parseUnifiedDiff(diff);
			emitReviewEvent(reviewId, {
				type: 'step',
				step: 'review',
				message: `Reviewing ${files.length} files with 4 agents…`
			});
			const results = await runAllRoles(
				{ diff, sandboxPath },
				{
					onLog: (role, message) =>
						emitReviewEvent(reviewId, { type: 'log', step: `agent:${role}`, message }),
					onAgentStart: (role) =>
						emitReviewEvent(reviewId, {
							type: 'step',
							step: `agent:${role}`,
							message: `${role} agent started`,
							data: { agent: role, status: 'running' }
						}),
					onAgentDone: (role, findings) =>
						emitReviewEvent(reviewId, {
							type: 'done',
							step: `agent:${role}`,
							message: `${role} done: ${findings} finding(s)`,
							data: { agent: role, status: 'done', findings }
						})
				}
			);
			findings = results.flatMap((r) => r.findings);
			const fileCount = files.length;
			summary =
				`Reviewed PR #${review.prNumber} (${fileCount} files) with ` +
				results.map((r) => `${r.role} (${r.findings.length})`).join(', ') +
				'.';
		} else {
			const steps = demoReviewSteps({
				repo: repo?.name ?? review.repoId,
				pr: String(review.prNumber),
				sandbox: sandboxPath ?? '(stub mode: no sandbox)'
			});
			for (const step of steps) {
				const run = await runCommand({ label: step.label, command: step.command, args: step.args });
				review = touch(reviewId, { runs: [...review.runs, run.id] });
				if (run.status !== 'succeeded') {
					throw new Error(`step "${step.label}" ${run.status} (exit ${run.exitCode})`);
				}
			}
			findings = [
				{
					id: crypto.randomUUID(),
					file: 'README.md',
					line: 1,
					severity: 'info',
					message: 'Stub finding: wire a real reviewer into commands/registry.ts to get real findings.'
				}
			];
			summary =
				review.source === 'github' || review.source === 'gitlab'
					? `Fetched PR #${review.prNumber} into ${sandboxPath}. Demo steps only — set RECODER_REVIEW_API_KEY to run the reviewer harness.`
					: `Demo review of PR #${review.prNumber} completed in stub mode (provider CLI unavailable).`;
		}

		touch(reviewId, { status: 'passed', summary, findings });
		emitReviewEvent(reviewId, {
			type: 'done',
			message: `Review complete: ${findings.length} finding(s)`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'pipeline failed';
		touch(reviewId, { status: 'failed', summary: message });
		emitReviewEvent(reviewId, { type: 'error', message });
	}
}
