import { findingKind } from '@recoder/shared';
import type { CandidateFinding } from '../consolidate.js';

/** Escalation runs only when `RECODER_VERIFY_ESCALATE=1`; off, verification is unchanged. */
export function escalateOn(): boolean {
	return process.env.RECODER_VERIFY_ESCALATE === '1';
}

/**
 * Whether a first verifier's settled verdict gets a second verifier on the
 * Review model: a bug that could be published but that the first verifier
 * neither proved nor disproved, so one inconclusive run on the cheaper model
 * doesn't hide it.
 */
export function escalates(candidate: CandidateFinding, attempt: number): boolean {
	return (
		escalateOn() &&
		attempt === 1 &&
		candidate.valid &&
		findingKind(candidate.category) === 'bug' &&
		!candidate.belowBar &&
		candidate.verification?.status !== 'verified'
	);
}

/** What the second verifier is told about the first: why it could not settle the finding. */
export function escalationNote(candidate: CandidateFinding): string {
	const reason = candidate.verification?.reason;

	if (!reason) return '';

	return `\n\nAn earlier verifier could not settle this finding: ${reason}\nSettle it another way: a different entry point, input or command.`;
}
