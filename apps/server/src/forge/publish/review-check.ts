import { FINDING_SEVERITIES, type CheckThreshold, type Finding, type FindingSeverity } from '@recoder/shared';
import type { CommitStatus } from './forge';

const SEVERITY_WORD: Record<FindingSeverity, string> = { error: 'error', warning: 'warning', info: 'low' };

/** True when a reportable finding's severity meets or exceeds `threshold`. */
export function failsCheckThreshold(finding: Pick<Finding, 'severity'>, threshold: CheckThreshold): boolean {
	if (threshold === 'off') return false;

	return FINDING_SEVERITIES.indexOf(finding.severity) >= FINDING_SEVERITIES.indexOf(threshold);
}

/**
 * The commit status for the review's head: failed when a reportable finding is
 * at or above the threshold, else passed. Null when the check is off.
 * Unverified findings never count (#74: unresolved work is not a defect).
 */
export function checkStatus(
	reportable: readonly Finding[],
	threshold: CheckThreshold,
	target: { sha: string; url: string | null }
): CommitStatus | null {
	if (threshold === 'off') return null;

	const failing = reportable.filter((finding) => failsCheckThreshold(finding, threshold)).length;
	const level = `${SEVERITY_WORD[threshold]}${threshold === 'error' ? '' : ' or above'}`;

	const description = failing
		? `${failing} verified ${failing === 1 ? 'finding' : 'findings'} at ${level}`
		: `No verified findings at ${level}`;

	return { ...target, state: failing ? 'failure' : 'success', description };
}
