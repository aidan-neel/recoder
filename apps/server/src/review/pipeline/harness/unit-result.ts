import type { ReviewAssignment } from '@recoder/shared';
import { validateCandidate } from '../consolidate.js';
import type { ReviewerOutput } from '../reviewer.js';
import type { ReviewUnit } from '../units.js';
import { recordFor, updateAssignment } from './assignments.js';
import { anchorFn, fingerprintFinding } from './findings.js';
import type { PoolContext, ScopedPatch } from './pool.js';

/**
 * Records a reviewer's answer: coverage, candidates, recommended checks and
 * subagent requests. A reviewer that answered has finished; hunks it couldn't
 * assess show up as coverage gaps. A subagent's answer adds only candidates
 * and checks: its hunks are already a unit's, and it can't ask for subagents.
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
		creditCoverage(item, role, ctx, output, initialEvidence);

		for (const request of output.subagents) ctx.requests.push({ unitId: item.id, unitTitle: item.title, request });
	}

	addCandidates(item, role, ctx, model, output);

	for (const check of output.recommendedChecks) ctx.recommended.add(check);

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
		agent: role,
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
	item: ReviewUnit,
	role: string,
	ctx: PoolContext,
	output: ReviewerOutput,
	initialEvidence: ScopedPatch
): void {
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

/** Validates each reported finding against the inventory and evidence, fingerprinted by the code it points at. */
function addCandidates(item: ReviewUnit, role: string, ctx: PoolContext, model: string, output: ReviewerOutput): void {
	const anchor = anchorFn(ctx.inventory);

	for (const raw of output.findings) {
		ctx.candidates.push(
			validateCandidate(
				raw,
				{
					candidateId: ctx.nextCandidate(),
					assignmentId: item.id,
					role,
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
