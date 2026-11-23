import { findingKind } from '@recoder/shared';
import type { CandidateFinding } from '../consolidate.js';

/** An inconclusive fast attempt gets the existing second attempt with the full payload and verifier limits. */
export function needsVerifierFallback(candidate: CandidateFinding, limited: boolean | undefined): boolean {
	if (!limited || candidate.refuted) return false;

	const proof = candidate.verification;

	return proof?.status !== 'verified' || (findingKind(candidate.category) === 'bug' && proof.method !== 'run');
}
