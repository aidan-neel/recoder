import type { Finding } from '@recoder/shared';
import { claimTerms, sameClaim, termsOf, type ClaimTerms } from '../pipeline/harness/findings.js';
import { diffLines, lineText, type DiffFiles } from './code-change.js';

/**
 * What a defect is across the reviews of one pull request: where it lives
 * (its file and enclosing symbol), what it claims (`claimTerms`: its
 * trigger, consequence, violated contract, rule or smell, title and body)
 * and the code its trigger names (`operands`). Its line and category are left
 * out, so a moved line or a re-filed category keeps the defect.
 * `Finding.fingerprint`, which hashes file, category class, symbol and line
 * text, stays as it is for saved reviews, votes and evals.
 */
export interface DefectIdentity {
	file: string;
	/** Absent on older findings and on findings outside any symbol. */
	symbol?: string;
	claim: ClaimTerms;
	/**
	 * The terms of the trigger (the title, when a detector stated none) that
	 * the pull request's code in the file also holds: the arguments, fields
	 * or calls the defect is about, such as the `limit` a missing check lets
	 * through.
	 */
	operands: ReadonlySet<string>;
}

/**
 * The finding's identity, read against its own review's diff: body words that
 * only restate the finding's line are left out, as consolidation does, so two
 * defects whose bodies quote the same line stay apart.
 */
export function defectIdentity(finding: Finding, files: DiffFiles): DefectIdentity {
	const code = new Set(
		termsOf(
			diffLines(files, finding.file)
				.map((line) => line.text)
				.join('\n')
		)
	);

	const trigger = termsOf(finding.claim?.trigger ?? finding.title ?? '');

	return {
		file: finding.file,
		...(finding.symbol ? { symbol: finding.symbol } : {}),
		claim: claimTerms(finding, lineText(files, finding)),
		operands: new Set(trigger.filter((term) => code.has(term)))
	};
}

/**
 * Whether two identities are one defect: the same file, the same symbol when
 * both name one, claims `sameClaim` takes for one, and no sign that they are
 * the same failure on different code (`namesOtherOperands`). Two different
 * defects in one symbol claim different things, so they stay apart.
 */
export function sameDefect(a: DefectIdentity, b: DefectIdentity): boolean {
	if (a.file !== b.file) return false;
	if (a.symbol && b.symbol && a.symbol !== b.symbol) return false;
	if (namesOtherOperands(a, b)) return false;

	return sameClaim(a.claim, b.claim);
}

/**
 * Whether each trigger names code the other claim never mentions: one
 * failure on two operands, such as a missing check on `limit` and the same
 * missing check on `offset`. Their words are otherwise alike, so `sameClaim`
 * alone takes them for one defect. Both sides must name such code, so a
 * report that adds a detail to the same trigger stays the same defect.
 */
function namesOtherOperands(a: DefectIdentity, b: DefectIdentity): boolean {
	return namesOperandOutside(a, b) && namesOperandOutside(b, a);
}

/** Whether `a`'s trigger names code that `b`'s claim does not mention. */
function namesOperandOutside(a: DefectIdentity, b: DefectIdentity): boolean {
	return [...a.operands].some((term) => !b.claim.terms.has(term));
}
