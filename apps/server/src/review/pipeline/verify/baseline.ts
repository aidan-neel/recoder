import type { BaseComparisonResult, ComparedRun, FindingVerification, VerificationBaseline } from '@recoder/shared';
import type { EvidenceRecord } from '../../../evidence/evidence.js';
import { classifyRun, missingDiffPaths, missingFiles, type DiffChanges } from '../harness/run-outcome.js';
import { runCause, sameCause, sameCauses } from './cause.js';
import { brokeInSetup, failedOnTarget, quotedSpans, runOutput } from './runs.js';

/** Added to a reason when the proving command ends the same way on the merge-base tree. */
const SAME_ON_BASE =
	'The same command also ends this way before this change, so it may be a pre-existing bug or a repro that does not isolate the change.';

/** Why a comparison that settles nothing could not say how the base ends. */
const UNSETTLED = {
	incompatible: 'the base commit cannot run the new API or fixture',
	environment: 'the command could not run on the base commit',
	unstable: 'repeated runs on the base commit disagree'
};

/** What a runtime prints when code calls or imports a name that does not exist there. */
const MISSING_NAME = [
	/does not provide an export named ['"]?(\w+)/g,
	/Export named ['"](\w+)['"] not found/g,
	/No matching export in "[^"]*" for import "(\w+)"/g,
	/has no exported member (?:named )?['"](\w+)['"]/g,
	/\b(\w+) is not (?:a function|a constructor|defined)\b/g,
	/Cannot find name ['"](\w+)['"]/g
];

/** A path a command names, as `commandPackage` reads one. */
const COMMAND_PATH = /^[\w@][\w./@-]*\.(?:[cm]?[jt]sx?|svelte|vue|py|json)$/;

/** The sandbox's runtime and the install's digest, the same for both revisions: the base tree links the head's install. */
export interface RunIdentity {
	runtime: string;
	dependencies: string;
}

/** A run's identity when the sandbox could not say. */
export const UNKNOWN_IDENTITY: RunIdentity = { runtime: 'unknown', dependencies: 'unknown' };

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
 * Whether a failed base run could not execute what the change added: a module
 * or file the diff added, a declaration it added, or a command naming a path
 * it added.
 */
function cannotRunNewCode(base: EvidenceRecord, changes: DiffChanges): boolean {
	const output = runOutput(base);
	const named = MISSING_NAME.flatMap((pattern) => [...output.matchAll(pattern)].map((match) => match[1]!));
	const paths = base.command?.split(/[\s'"=]+/).filter((token) => COMMAND_PATH.test(token)) ?? [];

	return (
		missingDiffPaths(output, changes.added).length > 0 ||
		named.some((name) => changes.symbols.includes(name)) ||
		paths.some((path) => missingDiffPaths(`Cannot find module '/${path}'`, changes.added).length > 0)
	);
}

/**
 * Whether a failed base run could not find a repo file or module while the
 * head run found every one: the base tree lacks something the head's checkout
 * had, such as an untracked fixture or generated file.
 */
function lacksFile(proof: EvidenceRecord, base: EvidenceRecord): boolean {
	return base.exitCode !== 0 && missingFiles(runOutput(base)).length > 0 && !missingFiles(runOutput(proof)).length;
}

/**
 * How a head run that failed on the code compares with a base run that did
 * too, by cause: every head failure on the base is pre-existing, unless the
 * runner counts more failures on the head; a head whose failing tests all
 * passed on the base is a regression; anything else is worse than the base.
 */
function compareFailures(proof: EvidenceRecord, base: EvidenceRecord, samePrint: boolean): BaseComparisonResult {
	const [head, there] = [runCause(proof), runCause(base)];

	if (samePrint && sameCause(head, there, runOutput(base)))
		return head.failures !== null && there.failures !== null && head.failures > there.failures
			? 'worsened'
			: 'pre-existing';

	if (head.failed.length && head.failed.every((test) => there.passed.includes(test))) return 'regression';

	return 'worsened';
}

/**
 * How one base run compares with the head's proving run. The base's own end
 * is read first: one that never finished, stopped in setup or missed a file
 * the head found is the environment, unless it stopped on what the change
 * added. A head run that passed proves by what it printed, so the verifier's
 * quoted spans decide there; one that failed is a regression against a
 * passing base and is compared by cause against a failing one.
 */
function readBase(proof: EvidenceRecord, spans: string[], base: EvidenceRecord, changes: DiffChanges) {
	if (base.exitCode === null || base.exitCode === undefined) return 'environment';
	if (base.exitCode !== 0 && cannotRunNewCode(base, changes)) return 'incompatible';
	if (brokeInSetup(base) || lacksFile(proof, base)) return 'environment';

	const output = runOutput(base);
	const samePrint = spans.every((span) => output.includes(span));

	if (base.exitCode !== 0 && !failedOnTarget(proof)) return 'worsened';
	if (base.exitCode === 0) return samePrint && !failedOnTarget(proof) ? 'pre-existing' : 'regression';

	return compareFailures(proof, base, samePrint);
}

/** Whether a base run's failure is ambiguous, so it is run once more: it failed on the code but not for the head's cause. */
export function ambiguousBase(
	proof: EvidenceRecord,
	reason: string,
	base: EvidenceRecord,
	changes: DiffChanges
): boolean {
	const read = readBase(proof, printedSpans(proof, reason), base, changes);

	return failedOnTarget(base) && read !== 'pre-existing' && read !== 'incompatible';
}

/** Whether two runs of one command on the base end the same way: the same exit code and the same causes. */
function agree(first: EvidenceRecord, again: EvidenceRecord): boolean {
	return first.exitCode === again.exitCode && sameCauses(runCause(first), runCause(again));
}

/** A run as a base comparison records it. */
export function comparedRun(run: EvidenceRecord, identity: RunIdentity): ComparedRun {
	const cause = runCause(run);

	return { exitCode: run.exitCode ?? null, failure: cause.failure, location: cause.location, ...identity };
}

/**
 * How the proving command ended on the merge-base tree against the head, by
 * cause and never by exit code alone. `bases` holds the first base run, then
 * the rerun of an ambiguous one; runs that disagree are unstable. Only a
 * pre-existing result ends the same way. Incompatible, environment and
 * unstable results are unavailable, so none of them calls a head failure
 * pre-existing.
 */
export function compareToBase(
	proof: EvidenceRecord,
	reason: string,
	bases: [EvidenceRecord, EvidenceRecord?],
	changes: DiffChanges,
	identity: RunIdentity = UNKNOWN_IDENTITY
): VerificationBaseline {
	const [first, again] = bases;
	const read = readBase(proof, printedSpans(proof, reason), first, changes);
	const result = again && !agree(first, again) ? 'unstable' : read;
	const runs = again ? [first, again] : [first];

	const record = {
		result,
		head: comparedRun(proof, identity),
		baseRuns: runs.map((run) => comparedRun(run, identity))
	};

	if (result === 'environment' && (first.exitCode === null || first.exitCode === undefined))
		return { unavailable: 'the command did not finish there', ...record };

	if (result === 'incompatible' || result === 'environment' || result === 'unstable')
		return { unavailable: UNSETTLED[result], ...record };

	return { exitCode: first.exitCode ?? null, differs: result !== 'pre-existing', ...record };
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
