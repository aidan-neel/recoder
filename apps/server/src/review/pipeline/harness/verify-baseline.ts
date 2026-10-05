import type { FindingVerification, VerificationBaseline } from '@recoder/shared';
import type { EvidenceStore } from '../../../evidence/evidence.js';
import type { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { baseRecord, compareToBase, withBaseline } from '../verify/baseline.js';

/** What the harness needs to run a verifier's proving command on the merge-base tree. */
export interface BaseRunContext {
	evidence: EvidenceStore;
	/** The review's sandbox; null when code cannot run. */
	workspace: ExecWorkspace | null;
	mergeBaseSha: string | null;
	deadlineAt: () => number;
	signal: AbortSignal;
}

/** The proving command run once on the merge-base tree; anything that goes wrong is reported as unavailable. */
async function baselineOf(verification: FindingVerification, ctx: BaseRunContext, agentId: string) {
	const proof = verification.evidence && ctx.evidence.get(verification.evidence.evidenceId);
	const { workspace, mergeBaseSha } = ctx;

	if (!proof || !workspace || !mergeBaseSha) return null;
	if (!proof.command || typeof proof.exitCode !== 'number') return { unavailable: 'the proving run did not finish' };
	if (ctx.signal.aborted || ctx.deadlineAt() <= reviewNow()) return { unavailable: 'the review is out of time' };

	const timeoutMs = REVIEW_POLICY.baseRunTimeoutMs;
	const ran = await workspace.runOnBase(proof.command, mergeBaseSha, timeoutMs, ctx.signal, agentId);

	if ('unavailable' in ran) return ran;

	return compareToBase(
		proof,
		verification.reason,
		baseRecord(proof.command, ran.timedOut ? null : ran.exitCode, ran.output)
	);
}

/**
 * A run-proved verification with its baseline: the same command run once on
 * the merge-base tree, by the harness, so it costs the verifier no turns. It
 * never changes the verdict. A failure of the machinery is recorded as
 * unavailable, and verifications that were not proved by a run pass through.
 */
export async function recordBaseline(
	verification: FindingVerification,
	ctx: BaseRunContext,
	agentId: string
): Promise<FindingVerification> {
	if (verification.method !== 'run' || !verification.evidence) return verification;

	const baseline: VerificationBaseline | null = await baselineOf(verification, ctx, agentId).catch((err) => ({
		unavailable: err instanceof Error ? err.message.slice(0, 120) : 'the base run failed'
	}));

	return baseline ? withBaseline(verification, baseline) : verification;
}
