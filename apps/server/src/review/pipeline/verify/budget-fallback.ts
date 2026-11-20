import { findingKind } from '@recoder/shared';
import type { CandidateFinding } from '../consolidate.js';

/** Exhaustion cannot settle an inconclusive finding; its existing second attempt keeps the full verifier limits. */
export function needsBudgetFallback(candidate: CandidateFinding, exhausted: boolean | undefined): boolean {
	if (!exhausted || candidate.refuted) return false;

	const proof = candidate.verification;

	return proof?.status !== 'verified' || (findingKind(candidate.category) === 'bug' && proof.method !== 'run');
}
