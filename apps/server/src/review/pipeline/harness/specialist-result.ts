import type { ReviewAssignment } from '@recoder/shared';
import { validateCandidate } from '../consolidate.js';
import type { PlannerAssignment } from '../planner.js';
import type { SpecialistOutput } from '../specialist.js';
import { recordFor, updateAssignment } from './assignments.js';
import { anchorFn, fingerprintFinding } from './findings.js';
import type { PoolContext, ScopedPatch } from './pool.js';

/**
 * Records a specialist's answer: coverage, candidates, recommended checks and any
 * follow-up it asked for. A specialist that answered has finished; hunks it
 * couldn't examine show up as coverage gaps.
 */
export function applySpecialistResult(
	item: PlannerAssignment,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string,
	output: SpecialistOutput,
	initialEvidence: ScopedPatch
): void {
	creditCoverage(item, ctx, output, initialEvidence);
	addCandidates(item, ctx, model, output);

	for (const check of output.recommendedChecks) ctx.recommended.add(check);
	if (output.followUp) ctx.followUps.push(toFollowUp(output.followUp));

	const validCount = ctx.candidates.filter((candidate) => candidate.assignmentId === item.id && candidate.valid).length;

	updateAssignment(records, item.id, {
		status: 'done',
		candidateCount: validCount,
		currentOperation: `Finished · ${validCount} candidate${validCount === 1 ? '' : 's'}`,
		completedAt: new Date().toISOString()
	});

	ctx.task(`assignment:${item.id}`, item.title, 'done', recordFor(records, item.id).currentOperation ?? 'Finished', {
		kind: 'assignment',
		assignmentId: item.id,
		agent: item.role,
		model,
		candidateCount: validCount,
		files: item.scope.map((entry) => entry.path)
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));
	ctx.events?.onCandidates?.(ctx.candidates.filter((candidate) => candidate.valid).length);
	ctx.onFinished?.();
}

/**
 * Models often list only some of the hunks they read. The scoped patch was in
 * their evidence, so what they were shown counts as examined unless they reported a gap for it.
 */
function creditCoverage(
	item: PlannerAssignment,
	ctx: PoolContext,
	output: SpecialistOutput,
	initialEvidence: ScopedPatch
): void {
	const assignedHunks = new Set(item.scope.flatMap((entry) => entry.hunkIds));
	const shownHunks = new Set(initialEvidence.flatMap((evidence) => evidence.hunkIds ?? []));
	const listedHunks = new Set(output.examinedHunks);
	const gapHunks = new Set(output.coverageGaps.map((gap) => gap.hunkId));

	const examined = [...assignedHunks].filter(
		(hunkId) => listedHunks.has(hunkId) || (shownHunks.has(hunkId) && !gapHunks.has(hunkId))
	);

	for (const hunkId of examined) {
		const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? '';

		ctx.coverage.examined(hunkId, path, item.role);
	}

	for (const hunkId of assignedHunks) {
		if (examined.includes(hunkId)) continue;

		const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? '';
		const gap = output.coverageGaps.find((itemGap) => itemGap.hunkId === hunkId);

		ctx.coverage.partial(hunkId, path, item.role, gap?.reason ?? 'assigned hunk was not examined');
	}
}

/** Validates each reported finding against the inventory and evidence, fingerprinted by the code it points at. */
function addCandidates(item: PlannerAssignment, ctx: PoolContext, model: string, output: SpecialistOutput): void {
	const anchor = anchorFn(ctx.inventory);

	for (const raw of output.findings) {
		ctx.candidates.push(
			validateCandidate(
				raw,
				{
					candidateId: ctx.nextCandidate(),
					assignmentId: item.id,
					role: item.role,
					model,
					fingerprint: (file, category, start, end, side) =>
						fingerprintFinding(file, category, anchor(file, start, end, side))
				},
				ctx.inventory,
				ctx.evidence
			)
		);
	}
}

/** A follow-up request as a planner assignment, defaulting what the specialist left out. */
function toFollowUp(followUp: NonNullable<SpecialistOutput['followUp']>): PlannerAssignment {
	return {
		id: followUp.id,
		role: followUp.role,
		title: followUp.title,
		reason: followUp.reason,
		scope: followUp.scope,
		questions: followUp.questions,
		contextEvidenceIds: followUp.contextEvidenceIds ?? [],
		priority: followUp.priority ?? 80
	};
}
