import type { Finding } from '@recoder/shared';
import { dismissalFingerprint, lineAnchor } from '../../pipeline/harness/findings.js';
import { buildInventory } from '../../pipeline/inventory.js';
import { extraExcludes } from '../../pipeline/review-scope.js';

/**
 * The fingerprint a later review matches a dismissed finding by. It reads the
 * finding as the review stored it, with the line text taken from the review's
 * diff, so it equals what the harness computed when the finding was raised.
 */
export function dismissalKey(finding: Finding, diff: string): string {
	const inventory = buildInventory(diff, extraExcludes());

	return dismissalFingerprint({
		file: finding.file,
		category: finding.category ?? '',
		ruleId: finding.ruleId,
		smell: finding.smell,
		symbol: finding.symbol,
		anchor: lineAnchor(inventory, finding.file, finding.line, finding.side ?? 'new')
	});
}
