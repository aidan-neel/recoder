import type { Finding, FindingFix } from '@recoder/shared';
import { db } from '../store';

/** Record a pushed fix on the review's finding, so it loads as Fixed from now on. */
export function markFindingFixed(reviewId: string, findingId: string, fix: FindingFix): boolean {
	const review = db.reviews.get(reviewId);
	if (!review?.findings.some((finding) => finding.id === findingId)) return false;
	db.reviews.set({
		...review,
		findings: review.findings.map((finding) => finding.id === findingId ? { ...finding, fix } : finding),
		updatedAt: new Date().toISOString()
	});
	return true;
}

/** A re-run (Continue review) keeps the fixes already pushed for the same findings. */
export function carryFixes(previous: Finding[], next: Finding[]): Finding[] {
	const fixes = new Map<string, FindingFix>();
	for (const finding of previous) {
		if (!finding.fix) continue;
		fixes.set(`id:${finding.id}`, finding.fix);
		if (finding.fingerprint) fixes.set(`fp:${finding.fingerprint}`, finding.fix);
	}
	if (!fixes.size) return next;
	return next.map((finding) => {
		const fix = fixes.get(`id:${finding.id}`) ?? (finding.fingerprint ? fixes.get(`fp:${finding.fingerprint}`) : undefined);
		return fix ? { ...finding, fix } : finding;
	});
}
