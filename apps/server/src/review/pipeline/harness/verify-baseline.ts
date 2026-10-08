import type { FindingVerification, VerificationBaseline } from '@recoder/shared';
import type { EvidenceRecord, EvidenceStore } from '../../../evidence/evidence.js';
import type { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import {
	ambiguousBase,
	baseRecord,
	compareToBase,
	comparedRun,
	UNKNOWN_IDENTITY,
	withBaseline,
	type RunIdentity
} from '../verify/baseline.js';
import type { DiffChanges } from './run-outcome.js';

/** What the harness needs to run a verifier's proving command on the merge-base tree. */
export interface BaseRunContext {
	evidence: EvidenceStore;
	/** The review's sandbox; null when code cannot run. */
	workspace: ExecWorkspace | null;
	mergeBaseSha: string | null;
	deadlineAt: () => number;
	signal: AbortSignal;
	/** What the diff added and removed, read when a base run fails: the change model may finish after verifiers start. */
	changes: () => DiffChanges;
}

/** Each sandbox's runtime and install identity, read once. */
const identities = new WeakMap<ExecWorkspace, Promise<RunIdentity>>();

/**
 * The sandbox's platform and tool versions and the digest of what its install
 * read, from the inputs a check result is cached under, without the prep
 * commands (the base tree is not prepared) or the install command. Unknown
 * when the sandbox cannot say: no repo scope, no lockfile, or no versions.
 */
function identityOf(workspace: ExecWorkspace): Promise<RunIdentity> {
	const known = identities.get(workspace);

	if (known) return known;

	const read = Promise.resolve()
		.then(() => workspace.checkInputs(''))
		.then((inputs) => {
			if (!inputs) return UNKNOWN_IDENTITY;

			const tools = inputs.tools.split('\n').filter((line) => line && line !== workspace.preparedWith);

			return { runtime: tools.join(', '), dependencies: inputs.dependencies };
		})
		.catch(() => UNKNOWN_IDENTITY);

	identities.set(workspace, read);

	return read;
}

/** The proving command once on the merge-base tree, as a base run, or why it could not run there. */
async function runBase(
	proof: EvidenceRecord & { command: string },
	ctx: BaseRunContext,
	agentId: string,
	timeoutMs: number
) {
	const ran = await ctx.workspace!.runOnBase(proof.command, ctx.mergeBaseSha!, timeoutMs, ctx.signal, agentId);

	return 'unavailable' in ran ? ran : baseRecord(proof.command, ran.timedOut ? null : ran.exitCode, ran.output);
}

/**
 * The recorded run's command run on the merge-base tree within `timeoutMs`,
 * and once more when its failure is ambiguous and time is left: the second
 * run says whether the first can be trusted.
 */
async function baselineOf(proofId: string, reason: string, ctx: BaseRunContext, agentId: string, timeoutMs: number) {
	const proof = ctx.evidence.get(proofId);
	const { workspace, mergeBaseSha } = ctx;
	const outOfTime = () => ctx.signal.aborted || ctx.deadlineAt() <= reviewNow();

	if (!proof || !workspace || !mergeBaseSha) return null;
	if (!proof.command || typeof proof.exitCode !== 'number') return { unavailable: 'the proving run did not finish' };
	if (outOfTime()) return { unavailable: 'the review is out of time', result: 'environment' as const };

	const run = { ...proof, command: proof.command };
	const first = await runBase(run, ctx, agentId, timeoutMs);

	if ('unavailable' in first)
		return {
			...first,
			result: 'environment' as const,
			head: comparedRun(proof, await identityOf(workspace)),
			baseRuns: []
		};

	const changes = ctx.changes();

	const again =
		ambiguousBase(proof, reason, first, changes) && !outOfTime() ? await runBase(run, ctx, agentId, timeoutMs) : null;

	const bases: [EvidenceRecord, EvidenceRecord?] = again && !('unavailable' in again) ? [first, again] : [first];

	return compareToBase(proof, reason, bases, changes, await identityOf(workspace));
}

/**
 * How a recorded run's command ends on the merge-base tree: null when there is
 * no such run or no sandbox, and anything that goes wrong reported as an
 * unavailable environment.
 */
export function runOnBaseline(
	proofId: string,
	reason: string,
	ctx: BaseRunContext,
	agentId: string,
	timeoutMs: number = REVIEW_POLICY.baseRunTimeoutMs
): Promise<VerificationBaseline | null> {
	return baselineOf(proofId, reason, ctx, agentId, timeoutMs).catch((err) => ({
		unavailable: err instanceof Error ? err.message.slice(0, 120) : 'the base run failed',
		result: 'environment' as const
	}));
}

/**
 * A run-proved verification with its baseline: the same command run on the
 * merge-base tree, by the harness, so it costs the verifier no turns. It
 * never changes the verdict. A failure of the machinery is recorded as
 * unavailable, and verifications that were not proved by a run pass through.
 */
export async function recordBaseline(
	verification: FindingVerification,
	ctx: BaseRunContext,
	agentId: string
): Promise<FindingVerification> {
	if (verification.method !== 'run' || !verification.evidence) return verification;

	const baseline = await runOnBaseline(verification.evidence.evidenceId, verification.reason, ctx, agentId);

	return baseline ? withBaseline(verification, baseline) : verification;
}
