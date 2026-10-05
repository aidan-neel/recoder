/**
 * Why a candidate below the reporting bar is published anyway: a verifier
 * reproduced it by running code, or it is a verified violation of a rule in
 * the repository's ledger. It never changes the severity the reviewer gave.
 */
export const PUBLISHED_BY = ['reproduced', 'rule'] as const;

export type PublishedBy = (typeof PUBLISHED_BY)[number];
