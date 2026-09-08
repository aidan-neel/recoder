import { parseUnifiedDiff, type Finding, type Review } from '@recoder/shared';
import { db, reviewDiffs, reviewSandboxes, reviewProgress } from '../store';
import { emitReviewEvent, reportReviewTask, trackReviewTask } from '../lib/events';
import { fetchPullRequest, GhError } from '../lib/gh';
import { fetchMergeRequest } from '../lib/glab';
import { filterNewFindings, runAllRoles } from '../lib/harness';
import { isReviewConfigured } from '../lib/models';
import { REVIEW_ROLES } from '../lib/roles';
import { detectProvider, locateRepo, refspecFor } from '../lib/providers';
import { prepareSandbox, sandboxDiff } from '../lib/sandbox';
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
 * A reviewer model is required — stub reviews that finish in seconds with
 * no real findings are worse than refusing outright.
 */
export function queueReview(input: QueueReviewInput): Review {
	if (!isReviewConfigured()) {
		throw new Error(
			'reviewer not configured: add a reviewer model in settings (or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL)'
		);
	}
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
	let baseRef: string | undefined;

	try {
		// 1. Fetch the PR. Offline provider CLI → stay in stub mode and continue.
		try {
			if (!repo) throw new Error('repo not found');
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
				data: { command: viewCmd }
			});
			const { pr, diff } = await trackReviewTask(reviewId, 'fetch', 'Fetching PR metadata', async () =>
				provider === 'gitlab'
					? await fetchMergeRequest(repo.url, review.prNumber, { env })
					: await fetchPullRequest(repo.url, review.prNumber, { env, metadataOnly: true }));
			baseRef = pr.base;
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
			const source = review.source;
			const { slug } = locateRepo(repo.url);
			const { fetchRef, branch } = refspecFor(review.source, review.prNumber);
			emitReviewEvent(reviewId, {
				type: 'step',
				step: 'sandbox',
				message: 'Preparing sandbox…',
				data: { command: `git fetch origin ${fetchRef.split(':')[0]}` }
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
			const diff = await trackReviewTask(reviewId, 'diff', 'Computing local PR diff', () =>
				sandboxDiff(sandbox.path, baseRef!, tokenEnv(source), source));
			reviewDiffs.set(reviewId, diff);
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
				message: `Reviewing ${files.length} files with ${REVIEW_ROLES.length} specialists…`
			});
			// Suppress anything an earlier review of this PR already reported:
			// re-runs only surface genuinely new findings. Computed up front so
			// live appends can filter the same way as the final pass.
			const previous = db.reviews
				.list()
				.filter(
					(r) => r.id !== reviewId && r.repoId === review.repoId && r.prNumber === review.prNumber && r.status === 'passed'
				)
				.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
			const previousFingerprints = new Set(
				(previous?.findings ?? []).flatMap((f) => (f.fingerprint ? [f.fingerprint] : []))
			);
			const appendLive = (role: string, items: Finding[]): Finding[] => {
				const { fresh } = filterNewFindings(items, previousFingerprints);
				for (const item of fresh) {
					if (item.fingerprint) previousFingerprints.add(item.fingerprint);
				}
				if (fresh.length === 0) return [];
				const current = db.reviews.get(reviewId);
				if (current) touch(reviewId, { findings: [...current.findings, ...fresh] });
				emitReviewEvent(reviewId, {
					type: 'finding',
					step: `agent:${role}`,
					message: `${role} reported ${fresh.length} finding${fresh.length === 1 ? '' : 's'}`,
					data: { agent: role, status: 'running', items: fresh, findings: fresh.length }
				});
				return fresh;
			};
			const results = await runAllRoles(
				{ diff, sandboxPath },
				{
					onTask: (task) => reportReviewTask(reviewId, task),
					onLog: (role, message) =>
						emitReviewEvent(reviewId, { type: 'log', step: `agent:${role}`, message }),
					onAgentStart: (role, model) =>
						emitReviewEvent(reviewId, {
							type: 'step',
							step: `agent:${role}`,
							message: `${role} agent started`,
							data: { agent: role, status: 'running', model }
						}),
					onAgentDone: (role, findings) =>
						emitReviewEvent(reviewId, {
							type: 'done',
							step: `agent:${role}`,
							message: `${role} done: ${findings} finding(s)`,
							data: { agent: role, status: 'done', findings }
						}),
					onFiles: (role, files) =>
						emitReviewEvent(reviewId, {
							type: 'log',
							step: `agent:${role}`,
							message: `${role} scanning ${files.length} file(s)`,
							data: { agent: role, status: 'running', files }
						}),
					onFindings: (role, items) => {
						appendLive(role, items);
					}
				}
			);
			findings = results.flatMap((r) => r.findings);
			const failedSpecialists = Object.values(reviewProgress.get(reviewId)?.tasks ?? {})
				.filter((task) => task.id.endsWith(':synthesis') && task.status === 'error');
			if (failedSpecialists.length) {
				throw new Error(failedSpecialists.length + ' specialist verification tasks failed. Partial findings are saved; restart the review to retry.');
			}
			const { fresh, suppressed } = filterNewFindings(
				findings,
				new Set((previous?.findings ?? []).flatMap((f) => (f.fingerprint ? [f.fingerprint] : [])))
			);
			findings = fresh;
			const fileCount = files.length;
			summary =
				`Reviewed PR #${review.prNumber} (${fileCount} files) with ` +
				results.map((r) => `${r.role} (${r.findings.length})`).join(', ') +
				(suppressed > 0
					? ` ${suppressed} already-reported finding${suppressed === 1 ? '' : 's'} suppressed.`
					: '');
		} else {
			emitReviewEvent(reviewId, {
				type: 'log',
				step: 'demo',
				message: 'No reviewer model configured — stub demo steps (add a model in settings for live agent output).'
			});
			const steps = demoReviewSteps({
				repo: repo?.name ?? review.repoId,
				pr: String(review.prNumber),
				sandbox: sandboxPath ?? '(stub mode: no sandbox)'
			});
			for (const step of steps) {
				emitReviewEvent(reviewId, { type: 'step', step: 'demo', message: `${step.label}…` });
				const run = await runCommand({ label: step.label, command: step.command, args: step.args });
				review = touch(reviewId, { runs: [...review.runs, run.id] });
				if (run.status !== 'succeeded') {
					throw new Error(`step "${step.label}" ${run.status} (exit ${run.exitCode})`);
				}
				emitReviewEvent(reviewId, { type: 'log', step: 'demo', message: `${step.label}: done` });
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

		reportReviewTask(reviewId, { id: 'finalize', label: 'Saving results', message: 'Saving review results', status: 'running' });
		touch(reviewId, { status: 'passed', summary, findings });
		reportReviewTask(reviewId, { id: 'finalize', label: 'Saving results', message: 'Review results saved', status: 'done' });
		emitReviewEvent(reviewId, {
			type: 'done',
			message: `Review complete: ${findings.length} finding(s)`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'pipeline failed';
		try {
			touch(reviewId, { status: 'failed', summary: message });
		} catch {
			// Review was deleted mid-run (e.g. its session was closed) — nothing to update.
		}
		emitReviewEvent(reviewId, { type: 'error', message });
	}
}
