import type { FindingVerification } from '@recoder/shared';
import type { EvidenceRecord, EvidenceStore } from '../../../evidence/evidence.js';
import type { VerdictOutput } from '../verify.js';
import { brokeInSetup, claimedOutput, failedOnTarget, observedExcerpt, ownRuns, showsDefect } from './runs.js';

/** The verification of a finding the verifier could not prove. */
function inconclusive(reason: string): FindingVerification {
	return { status: 'unverified', outcome: 'inconclusive', reason };
}

/** The verification of a finding proven by `proof`, with what it was meant to show and what it showed. */
function reproduced(proof: EvidenceRecord, output: VerdictOutput): FindingVerification {
	const command = proof.command ?? '';
	const exitCode = proof.exitCode ?? null;

	return {
		status: 'verified',
		method: 'run',
		outcome: 'reproduced',
		reason: output.reason,
		command,
		exitCode,
		evidence: {
			command,
			exitCode,
			...(output.expected ? { expected: output.expected } : {}),
			observed: observedExcerpt(proof, output.reason),
			evidenceId: proof.id
		}
	};
}

/**
 * The run that proves a confirmation: one that failed on the code under test
 * or printed what the verifier quoted, else the last that reached the code.
 * That last resort is not enough when the verifier quoted output no run
 * printed (a `mutation` verifier quotes its own edit, so it keeps it).
 */
function provingRun(runs: EvidenceRecord[], reason: string, mutation: boolean): EvidenceRecord | undefined {
	const shown = runs.find((run) => showsDefect(run, reason));

	if (shown) return shown;
	if (!mutation && claimedOutput(reason, runs).length) return undefined;

	return runs.filter((run) => !brokeInSetup(run)).at(-1);
}

/**
 * Turn a verifier's answer into the finding's verification, or `refuted`.
 * Only runs this verifier made count: a baseline check or another agent's run
 * never settles it. A confirmation that cites one is proven by it: the run
 * that failed or printed what the verifier quoted when there is one, else the
 * last it cited that reached the code, unless the reason quotes output no run
 * printed, which leaves it traced. A run that broke during setup (a
 * missing module, a syntax error) proves nothing either way. How the
 * verifier words its reason never hides a finding it reproduced; `verifierPushBack` asks for a failing assertion while turns
 * remain. A refutation needs a run that passed, else the finding is left
 * unverified, never dropped. Without a run, a confirmation that cites code
 * counts as traced, and a disagreement from reading alone is left to
 * consolidation with the verifier's reason (a misread would hide a real bug).
 * A weak-test finding is settled by `mutation`, where the exit codes mean the
 * opposite: only a run that failed, the test catching the planted bug, refutes it.
 */
export function settleVerdict(
	output: VerdictOutput,
	evidence: EvidenceStore,
	agentId: string,
	mutation = false
): FindingVerification | 'refuted' {
	const cited = output.evidenceIds.map((id) => evidence.get(id)).filter((record) => record !== undefined);
	const runs = ownRuns(output.evidenceIds, evidence, agentId);

	if (output.verdict === 'unverified') return inconclusive(output.reason);

	if (output.verdict === 'confirmed' && runs.length) {
		const proof = provingRun(runs, output.reason, mutation);

		if (proof) return reproduced(proof, output);

		if (runs.every((run) => brokeInSetup(run)))
			return inconclusive(`The cited run failed before it reached the code under test: ${output.reason}`);
	}

	if (output.verdict === 'refuted' && runs.length) {
		if (runs.some((run) => (mutation ? failedOnTarget(run, true) : run.exitCode === 0))) return 'refuted';

		return inconclusive(
			mutation
				? `The verifier disagrees, but no planted bug made the test fail: ${output.reason}`
				: `The verifier disagrees, but its run did not pass: ${output.reason}`
		);
	}

	if (output.verdict === 'confirmed' && cited.length)
		return { status: 'verified', method: 'trace', outcome: 'traced', reason: output.reason };
	if (output.verdict === 'refuted' && cited.length)
		return inconclusive(`The verifier disagrees without a run of its own: ${output.reason}`);

	return inconclusive(`${output.reason} (No evidence was cited, so this was not counted as proof.)`);
}

/**
 * A verification with its outcome filled in: a run reproduced it, any other
 * proof traced it, no proof leaves it inconclusive. Verifications that already
 * carry one, and older saved ones, are told apart the same way.
 */
export function withOutcome(verification: FindingVerification): FindingVerification {
	if (verification.outcome) return verification;
	if (verification.status === 'unverified') return { ...verification, outcome: 'inconclusive' };

	return { ...verification, outcome: verification.method === 'run' ? 'reproduced' : 'traced' };
}

/**
 * Why a verdict goes back to its verifier while turns remain, or null to take
 * it. One that ran nothing must run something. A confirmation none of whose
 * own runs failed or printed what it quotes rests on the model's reading of
 * printed values, so it is asked for a repro that fails by itself. A
 * `mutation` verifier's proof is a passing run, so only a refutation is
 * checked: it needs a run the planted bug made fail.
 */
export function verifierPushBack(
	output: VerdictOutput,
	state: { runs: number },
	evidence: EvidenceStore,
	agentId: string,
	mutation = false
): string | null {
	if (state.runs === 0)
		return mutation
			? 'You have not run anything yet. Plant the bug in the code under test and run the test in the same command, then give your verdict citing that run.'
			: 'You have not run anything yet. Write a small script or test that exercises the finding and run it (or run the existing tests or type check for this code), then give your verdict citing that run.';

	if (mutation) {
		const cited = ownRuns(output.evidenceIds, evidence, agentId);

		if (output.verdict !== 'refuted' || cited.some((run) => failedOnTarget(run, true))) return null;

		if (cited.some((run) => brokeInSetup(run, true)))
			return 'The run you cited failed because the edit did not parse or a module was missing, so the test never judged the behavior. Plant a bug that still compiles, run the test in the same command, and cite that run.';

		return 'No run you cited failed, so nothing shows the test catching a bug. A test that passes unchanged does not refute the finding. Plant the bug the finding describes in the code under test, run the test in the same command, and cite that run: failing refutes the finding, still passing confirms it.';
	}

	if (output.verdict !== 'confirmed') return null;

	const runs = ownRuns(output.evidenceIds, evidence, agentId);

	if (runs.some((run) => showsDefect(run, output.reason))) return null;

	if (runs.length && runs.every((run) => brokeInSetup(run)))
		return 'The run you cited failed before it reached the code under test (a missing module, binary or test file), so it proves nothing. Fix the repro so it imports and runs the changed code, run it again, and cite that run.';

	return 'No run you cited proves this by itself: each exited 0, and your reason quotes no line of its output. Turn the repro into an assertion that compares the actual value with the expected one and exits nonzero when the finding is true (a failing expect, a throw, process.exit(1)). Run it and cite that run, copying the failing output line into the reason in backticks. If the assertion passes, answer "refuted". If no run can show it, keep your verdict and say why.';
}
