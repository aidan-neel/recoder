import type { Finding } from '@recoder/shared';
import { dismissalFingerprint, lineAnchor } from '../../pipeline/harness/findings.js';
import { buildInventory } from '../../pipeline/inventory.js';
import { extraExcludes } from '../../pipeline/review-scope.js';
import { voteKeyOf } from './votes.js';

/** What a decision on one finding is learned under: its vote (`voteKeyOf`) and its remembered dismissal (`dismissalKey`). */
export interface LearningKeys {
	vote: string;
	dismissal: string;
}

/**
 * The fingerprint a later review matches a dismissed finding by, in the form
 * `dismissalFingerprint` writes. It reads the finding as the review stored it,
 * with the line text taken from the review's diff, so it equals what the
 * harness computed when the finding was raised.
 */
export function dismissalKey(finding: Finding, diff: string): string {
	const inventory = buildInventory(diff, extraExcludes());

	return dismissalFingerprint(
		{ ...finding, category: finding.category ?? '' },
		lineAnchor(inventory, finding.file, finding.line, finding.side ?? 'new')
	);
}

/** The keys a decision on the finding, as stored by the review whose diff is `diff`, is learned under. */
export function learningKeys(finding: Finding, diff: string): LearningKeys {
	return { vote: voteKeyOf(finding), dismissal: dismissalKey(finding, diff) };
}
