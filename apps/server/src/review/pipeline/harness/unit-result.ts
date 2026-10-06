import type { ReviewAssignment } from '@recoder/shared';
import { isReportable, validateCandidate, type CandidateFinding } from '../consolidate.js';
import { isQualityLens } from '../lenses/lenses.js';
import { followedUpBy, recordReply } from '../question-ledger.js';
import type { ReviewerOutput } from '../reviewer.js';
import type { ReviewUnit } from '../units.js';
import { coverageRole, recordFor, updateAssignment } from './assignments.js';
import type { PoolContext, ScopedPatch } from './pool.js';

/**
 * Records a lens reviewer's answer: coverage for its lens, candidates,
 * recommended checks, how a defect lens answered the brief questions it was
 * shown and, from the correctness lens only, subagent requests. A reviewer
 * that answered has finished; hunks it couldn't assess show up as coverage
 * gaps. A subagent's answer adds candidates, checks and its answer to the
 * brief questions it follows up: its hunks are already a lens's, and it
 * can't ask for subagents.
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

		if (item.lens === 'correctness') {
			for (const request of output.subagents) ctx.requests.push({ unitId: item.id, unitTitle: item.title, request });
		}
	}

	const added = addCandidates(item, role, ctx, model, output);

	recordQuestions(item, role, ctx, output, added);

	for (const check of output.recommendedChecks) ctx.recommended.add(check);

	finishUnit(item, records, ctx, model, (count) => `Finished · ${count} candidate${count === 1 ? '' : 's'}`);
}

/**
 * Marks a unit's assignment done with `operation` for its reportable
 * candidate count, publishes it, then lets the run save a checkpoint.
 */
export function finishUnit(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string,
	operation: (candidates: number) => string
): void {
	const validCount = ctx.candidates.filter(
		(candidate) => candidate.assignmentId === item.id && isReportable(candidate)
	).length;

	updateAssignment(records, item.id, {
		status: 'done',
		candidateCount: validCount,
		currentOperation: operation(validCount),
		completedAt: new Date().toISOString()
	});

	ctx.task(`assignment:${item.id}`, item.title, 'done', recordFor(records, item.id).currentOperation ?? 'Finished', {
		kind: 'assignment',
		assignmentId: item.id,
		agent: recordFor(records, item.id).role,
		model,
		candidateCount: validCount,
		files: item.scope.map((entry) => entry.path)
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));
	ctx.events?.onCandidates?.(ctx.candidates.filter(isReportable).length);
	ctx.onFinished?.();
}

/**
 * Keeps what a reviewer said about the brief's questions, beside the
 * candidates its findings became. A defect lens accounts for the open
 * questions on its files and a follow-up subagent for the ones it was sent
 * to settle; quality lenses aren't shown any.
 */
function recordQuestions(
	item: ReviewUnit,
	role: string,
	ctx: PoolContext,
	output: ReviewerOutput,
	added: CandidateFinding[]
): void {
	if (role !== 'subagent' && (!item.lens || isQualityLens(item.lens))) return;

	const brief = ctx.intent?.openQuestions ?? [];
	const paths = new Set(item.scope.map((entry) => entry.path));
	const followed = new Set(role === 'subagent' ? followedUpBy(ctx.questions, item.id) : []);

	const shown = brief.filter((question) =>
		role === 'subagent' ? followed.has(question.id) : paths.has(question.file)
	);

	const findings = added.map((candidate, index) => ({ questionId: output.findings[index]?.questionId, candidate }));
	const reply = { owner: item.id, shown, brief, answered: output.answered, unsettled: output.unsettled, findings };

	recordReply(ctx.questions, reply, ctx.evidence);
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
 * subagent's (no lens) may be in any. Returns the candidates in the order of `output.findings`.
 */
export function addCandidates(
	item: ReviewUnit,
	role: string,
	ctx: PoolContext,
	model: string,
	output: ReviewerOutput
): CandidateFinding[] {
	const lens = role === 'subagent' ? null : (item.lens ?? null);
	const dismissed = new Set(ctx.dismissals.map((dismissal) => dismissal.fingerprint));
	const added: CandidateFinding[] = [];

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

		added.push(candidate);
		ctx.candidates.push(candidate);
		ctx.onCandidate?.(candidate);
	}

	return added;
}
