import type { Finding } from '@recoder/shared';
import { claimTerms, sameClaim, type ClaimTerms } from '../pipeline/harness/findings.js';
import { lineText, type DiffFiles } from './code-change.js';

/**
 * What a defect is across the reviews of one pull request: where it lives
 * (its file and enclosing symbol) and what it claims (`claimTerms`: its
 * trigger, consequence, violated contract, rule or smell, title and body).
 * Its line and category are left out, so a moved line or a re-filed category
 * keeps the defect. `Finding.fingerprint`, which hashes file, category class,
 * symbol and line text, stays as it is for saved reviews, votes and evals.
 */
export interface DefectIdentity {
	file: string;
	/** Absent on older findings and on findings outside any symbol. */
	symbol?: string;
	claim: ClaimTerms;
}

/**
 * The finding's identity, read against its own review's diff: body words that
 * only restate the finding's line are left out, as consolidation does, so two
 * defects whose bodies quote the same line stay apart.
 */
export function defectIdentity(finding: Finding, files: DiffFiles): DefectIdentity {
	const anchor = lineText(files, finding.file, finding.line, finding.side ?? 'new');

	return {
		file: finding.file,
		...(finding.symbol ? { symbol: finding.symbol } : {}),
		claim: claimTerms(finding, anchor)
	};
}

/**
 * Whether two identities are one defect: the same file, the same symbol when
 * both name one, and claims `sameClaim` takes for one. Two different defects
 * in one symbol claim different things, so they stay apart.
 */
export function sameDefect(a: DefectIdentity, b: DefectIdentity): boolean {
	if (a.file !== b.file) return false;
	if (a.symbol && b.symbol && a.symbol !== b.symbol) return false;

	return sameClaim(a.claim, b.claim);
}
