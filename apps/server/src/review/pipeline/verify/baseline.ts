import type { FindingVerification, VerificationBaseline } from '@recoder/shared';
import type { EvidenceRecord } from '../../../evidence/evidence.js';
import { classifyRun } from '../harness/run-outcome.js';
import { brokeInSetup, failedOnTarget, quotedSpans, runOutput } from './runs.js';

/** Added to a reason when the proving command ends the same way on the merge-base tree. */
const SAME_ON_BASE =
	'The same command also ends this way before this change, so it may be a pre-existing bug or a repro that does not isolate the change.';

/**
 * A run on the merge-base tree, shaped like the recorded runs so the same
 * checks read it, with what it reached: the base tree is never prepared, so a
 * run there can stop in setup where the head's got through.
 */
export function baseRecord(command: string, exitCode: number | null, output: string): EvidenceRecord {
	const end = output.endsWith('\n') || !output ? '' : '\n';
	const outcome = classifyRun(command, { exitCode, output, timedOut: exitCode === null }, null);

	return {
		id: 'base',
		revision: 'mergeBase',
		path: '',
		startLine: 1,
		endLine: 1,
		content: `$ ${command}\n${output}${end}[exit ${exitCode}]`,
		truncated: false,
		kind: 'run',
		command,
		exitCode,
		...(outcome ? { outcome } : {})
	};
}

/** Spans the verifier quoted that the proving run printed, which a run elsewhere must print too to end the same way. */
function printedSpans(proof: EvidenceRecord, reason: string): string[] {
	const output = runOutput(proof);

	return quotedSpans(reason).filter((span) => span && !proof.command?.includes(span) && output.includes(span));
}

/**
 * How the proving command ended on the merge-base tree against the head. It
 * ends the same way when it exits the same side of zero and prints what the
 * verifier quoted from the head's output; anything else differs. A base run
 * that stopped before reaching the code settles nothing.
 */
export function compareToBase(proof: EvidenceRecord, reason: string, base: EvidenceRecord): VerificationBaseline {
	if (base.exitCode === null || base.exitCode === undefined) return { unavailable: 'the command did not finish there' };
	if (brokeInSetup(base)) return { unavailable: 'the command could not run on the base commit' };

	const sameExit = failedOnTarget(proof) === failedOnTarget(base);
	const spans = printedSpans(proof, reason);
	const output = runOutput(base);
	const samePrint = !spans.length || spans.some((span) => output.includes(span));

	return { exitCode: base.exitCode, differs: !(sameExit && samePrint) };
}

/** A run-proved verification carrying its baseline; one that ends the same way on the base says so in its reason. */
export function withBaseline(verification: FindingVerification, baseline: VerificationBaseline): FindingVerification {
	if (!verification.evidence) return verification;

	const same = 'differs' in baseline && !baseline.differs;

	return {
		...verification,
		reason: same ? `${verification.reason} ${SAME_ON_BASE}` : verification.reason,
		evidence: { ...verification.evidence, baseline }
	};
}
