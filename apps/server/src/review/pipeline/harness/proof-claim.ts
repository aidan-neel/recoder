import type { CandidateFinding } from '../consolidate.js';

/** A proof can be reused only for an explicitly identical claim, never a lexical similarity score. */
export function sameProofClaim(a: CandidateFinding, b: CandidateFinding): boolean {
	const key = (candidate: CandidateFinding) => {
		const claim = candidate.claim;

		const parts = claim
			? [claim.trigger, claim.consequence, claim.violatedContract]
			: [candidate.title ?? '', candidate.message];

		return JSON.stringify([
			candidate.file,
			candidate.side ?? 'new',
			candidate.ruleId,
			...parts.map((part) => part.trim().replace(/\s+/g, ' '))
		]);
	};

	return key(a) === key(b);
}
