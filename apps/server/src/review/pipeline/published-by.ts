import { evaluateRuleApplicability } from '../guidelines/ledger/applicability.js';
import { findLedgerRule, type RuleLedger } from '../guidelines/ledger/types.js';
import type { CandidateFinding } from './consolidate.js';

/**
 * Why a candidate below the reporting bar is published anyway: a verifier
 * reproduced it by running code, or it is a verified violation of a mandatory
 * rule in the repository's ledger. It never changes the severity the reviewer gave.
 */
export const PUBLISHED_BY = ['reproduced', 'rule'] as const;

export type PublishedBy = (typeof PUBLISHED_BY)[number];

/** Whether the candidate is verified like the rest but held back from the findings for being below the reporting bar. */
export function isHeldBack(candidate: CandidateFinding): boolean {
	return candidate.valid && candidate.belowBar === true && candidate.publishedBy === undefined;
}

/**
 * Whether a verifier ran code that shows the problem and the same run did not
 * end the same way before the change. One read from the code does not count.
 */
function isReproduced(candidate: CandidateFinding): boolean {
	const { verification } = candidate;
	const baseline = verification?.evidence?.baseline;
	const sameOnBase = baseline !== undefined && 'differs' in baseline && !baseline.differs;

	return verification?.status === 'verified' && verification.method === 'run' && !sameOnBase;
}

/**
 * Whether the candidate is a verified violation of a mandatory rule in the
 * ledger that applies to its file and changed lines. Advisory rules, scope
 * mismatches, overridden rules, and unverified assertions do not qualify.
 */
function isRuleViolation(candidate: CandidateFinding, ledger: RuleLedger | null): boolean {
	const rule = findLedgerRule(ledger, candidate.ruleId);
	const { verification } = candidate;
	const decisions = verification?.ruleCheck ?? candidate.ruleCheck;

	if (candidate.category !== 'repo-rule' || !rule || rule.level === 'advisory') return false;
	if (evaluateRuleApplicability(rule, candidate, ledger).outcome !== 'applies') return false;
	if (verification?.status !== 'verified' || verification.method !== 'rule') return false;

	return !decisions || (decisions.applicability.outcome === 'applies' && decisions.violation.outcome === 'violated');
}

/**
 * Settles whether a held-back candidate is published anyway, once its verdict
 * is recorded, and records why. Reproduction and a verified mandatory rule
 * violation establish that the finding is real, not how much it matters, so it
 * keeps the severity the reviewer gave it.
 */
export function publishHeldBack(candidate: CandidateFinding, ledger: RuleLedger | null): void {
	delete candidate.publishedBy;

	if (!candidate.belowBar) return;

	if (isReproduced(candidate)) candidate.publishedBy = 'reproduced';
	else if (isRuleViolation(candidate, ledger)) candidate.publishedBy = 'rule';
}

/** A candidate the review can report: valid, and not held back for being below the reporting bar. */
export function isReportable(candidate: CandidateFinding): boolean {
	return candidate.valid && !isHeldBack(candidate);
}
