import type { ReviewAssignment } from '@recoder/shared';
import { isReportable, validateCandidate } from '../consolidate.js';
import { isQualityLens } from '../lenses/lenses.js';
import type { ReviewerOutput } from '../reviewer.js';
import { recordAnswered, recordUnsettled } from '../subagents.js';
import type { ReviewUnit } from '../units.js';
import { coverageRole, recordFor, updateAssignment } from './assignments.js';
import type { PoolContext, ScopedPatch } from './pool.js';

/**
 * Records a lens reviewer's answer: coverage for its lens, candidates,
 * recommended checks, how a defect lens settled the brief questions it was shown and,
 * from the correctness lens only, subagent requests.
 * A reviewer that answered has finished; hunks it couldn't assess show up as
 * coverage gaps. A subagent's answer adds only candidates and checks: its
 * hunks are already a lens's, and it can't ask for subagents.
 */
export function applyUnitResult(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string,
	output: ReviewerOutput,
	initialEvidence: ScopedPatch
): void {
	const role = recordFor(records, item.id).role;

	if (role !== 'subagent') {
		creditCoverage(item, ctx, output, initialEvidence);
		markQuestions(item, ctx, output);

		if (item.lens === 'correctness') {
			for (const request of output.subagents) ctx.requests.push({ unitId: item.id, unitTitle: item.title, request });
		}
	}

	addCandidates(item, role, ctx, model, output);

	for (const check of output.recommendedChecks) ctx.recommended.add(check);

	const validCount = ctx.candidates.filter(
		(candidate) => candidate.assignmentId === item.id && isReportable(candidate)
	).length;

	updateAssignment(records, item.id, {
		status: 'done',
		candidateCount: validCount,
		currentOperation: `Finished · ${validCount} candidate${validCount === 1 ? '' : 's'}`,
		completedAt: new Date().toISOString()
	});

	ctx.task(`assignment:${item.id}`, item.title, 'done', recordFor(records, item.id).currentOperation ?? 'Finished', {
		kind: 'assignment',
		assignmentId: item.id,
		agent: role,
		model,
		candidateCount: validCount,
		files: item.scope.map((entry) => entry.path)
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));
	ctx.events?.onCandidates?.(ctx.candidates.filter(isReportable).length);
	ctx.onFinished?.();
}

/**
 * Notes how a defect lens settled the open questions the brief showed this unit, unsettled or answered; quality
 * lenses aren't shown any. A "confirmed" from a reviewer that reported no finding settles nothing.
 */
function markQuestions(item: ReviewUnit, ctx: PoolContext, output: ReviewerOutput): void {
	if (!item.lens || isQualityLens(item.lens)) return;

	const paths = new Set(item.scope.map((entry) => entry.path));
	const shown = (ctx.intent?.openQuestions ?? []).filter((question) => paths.has(question.file));
	const backed = output.answered.filter((answer) => answer.outcome === 'disproved' || output.findings.length > 0);

	recordUnsettled(ctx.unsettled, item.id, output.unsettled, shown);
	recordAnswered(ctx.answered, item.id, backed, shown);
}

/**
 * Models often list only some of the hunks they read. The scoped patch was in
 * their evidence, so what they were shown counts as examined unless they reported a gap for it.
 */
function creditCoverage(
	item: ReviewUnit,
	ctx: PoolContext,
	output: ReviewerOutput,
	initialEvidence: ScopedPatch
): void {
	const role = coverageRole(item);
	const assignedHunks = new Set(item.scope.flatMap((entry) => entry.hunkIds));
	const shownHunks = new Set(initialEvidence.flatMap((evidence) => evidence.hunkIds ?? []));
	const listedHunks = new Set(output.examinedHunks);
	const gapHunks = new Set(output.gaps.map((gap) => gap.hunkId));

	const examined = [...assignedHunks].filter(
		(hunkId) => listedHunks.has(hunkId) || (shownHunks.has(hunkId) && !gapHunks.has(hunkId))
	);

	for (const hunkId of examined) {
		const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? '';

		ctx.coverage.examined(hunkId, path, role);
	}

	for (const hunkId of assignedHunks) {
		if (examined.includes(hunkId)) continue;

		const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? '';
		const gap = output.gaps.find((itemGap) => itemGap.hunkId === hunkId);

		ctx.coverage.partial(hunkId, path, role, gap?.reason ?? 'hunk was not examined');
	}
}

/**
 * Validates each reported finding against the inventory, evidence, change
 * model and rule ledger, and hands it on to be verified. A lens's findings are held to its categories; a
 * subagent's (no lens) may be in any.
 */
function addCandidates(item: ReviewUnit, role: string, ctx: PoolContext, model: string, output: ReviewerOutput): void {
	const lens = role === 'subagent' ? null : (item.lens ?? null);
	const dismissed = new Set(ctx.dismissals.map((dismissal) => dismissal.fingerprint));

	for (const raw of output.findings) {
		const candidate = validateCandidate(
			raw,
			{ candidateId: ctx.nextCandidate(), assignmentId: item.id, role, model, lens },
			{
				inventory: ctx.inventory,
				evidence: ctx.evidence,
				changeModel: ctx.changeModel,
				ledger: ctx.ledger,
				intent: ctx.intent,
				reportLowSeverity: ctx.reportLowSeverity,
				dismissed
			}
		);

		ctx.candidates.push(candidate);
		ctx.onCandidate?.(candidate);
	}
}
