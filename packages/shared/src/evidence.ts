import type { Finding } from './findings';

/**
 * How a finding is supported, in the words the app and the forge comments
 * both use. `reproduced`: a command's output shows the problem. `traced`:
 * shown by reading the code, or by a deterministic check. `rule`: a quoted
 * repository rule or convention, and the code that breaks it. `unverified`:
 * nothing proved it.
 */
export type EvidenceClass = 'reproduced' | 'traced' | 'rule' | 'unverified';

export const EVIDENCE_LABELS: Record<EvidenceClass, string> = {
	reproduced: 'Reproduced',
	traced: 'Traced in code',
	rule: 'Repository rule',
	unverified: 'Not verified'
};

/** The evidence class of a finding. A verified finding with no recorded method counts as reproduced when it has a command. */
export function evidenceClass(finding: Pick<Finding, 'verification'>): EvidenceClass {
	const verification = finding.verification;

	if (verification?.status !== 'verified') return 'unverified';
	if (verification.method === 'rule' || verification.method === 'convention') return 'rule';
	if (verification.method === 'run') return 'reproduced';
	if (verification.method === undefined && verification.command) return 'reproduced';

	return 'traced';
}
