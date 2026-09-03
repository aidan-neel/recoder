import type { Review } from '@recoder/shared';
import { db } from '../store';
import { demoReviewSteps } from './registry';
import { runCommand } from './runner';

function touch(reviewId: string, patch: Partial<Review>): Review {
	const current = db.reviews.get(reviewId);
	if (!current) throw new Error(`review ${reviewId} not found`);
	const next: Review = { ...current, ...patch, updatedAt: new Date().toISOString() };
	db.reviews.set(next);
	return next;
}

/** Drive a queued review through its command steps, then mark it passed/failed. */
export async function runReviewPipeline(reviewId: string): Promise<void> {
	const initial = db.reviews.get(reviewId);
	if (!initial) return;
	const repo = db.repos.get(initial.repoId);
	let review = touch(reviewId, { status: 'running' });

	try {
		const steps = demoReviewSteps({ repo: repo?.name ?? review.repoId, pr: String(review.prNumber) });
		for (const step of steps) {
			const run = await runCommand({ label: step.label, command: step.command, args: step.args });
			review = touch(reviewId, { runs: [...review.runs, run.id] });
			if (run.status !== 'succeeded') {
				throw new Error(`step "${step.label}" ${run.status} (exit ${run.exitCode})`);
			}
		}
		touch(reviewId, {
			status: 'passed',
			summary: `Demo review of PR #${review.prNumber} completed. Replace demoReviewSteps() in commands/registry.ts with a real reviewer.`,
			findings: [
				{
					id: crypto.randomUUID(),
					file: 'README.md',
					line: 1,
					severity: 'info',
					message: 'Stub finding: wire a real reviewer into commands/registry.ts to get real findings.'
				}
			]
		});
	} catch (err) {
		touch(reviewId, {
			status: 'failed',
			summary: err instanceof Error ? err.message : 'pipeline failed'
		});
	}
}
