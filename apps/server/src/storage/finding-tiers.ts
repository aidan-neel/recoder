import { findingTier, type Finding, type Review } from '@recoder/shared';

/** Adds tiers to legacy full reviews on read, including retained unconfirmed findings. */
export function withFindingTiers(review: Review): Review {
	const normalize = (finding: Finding): Finding => ({ ...finding, tier: findingTier(finding) });

	return {
		...review,
		findings: review.findings.map(normalize),
		...(review.unconfirmed && { unconfirmed: review.unconfirmed.map(normalize) })
	};
}
