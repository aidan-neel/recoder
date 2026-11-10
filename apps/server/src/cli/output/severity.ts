import { FINDING_SEVERITIES, type FindingSeverity } from '@recoder/shared';

/** Every severity a finding can have, lowest first; a severity's rank is its position. */
export const SEVERITIES: readonly FindingSeverity[] = FINDING_SEVERITIES;

/** Whether a finding of this severity is at or above the minimum. */
export function meetsSeverity(severity: FindingSeverity, minimum: FindingSeverity): boolean {
	return SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(minimum);
}
