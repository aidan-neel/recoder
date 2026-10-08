import type { BriefQuestion, BriefQuestionFollowUp } from '@recoder/shared';
import type { CandidateFinding } from './consolidate.js';
import { hunkAt } from './harness/findings.js';
import type { CodeClaim } from './intent/types.js';
import type { ReviewInventory } from './inventory.js';
import { questionStatus, unsettledCount } from './question-ledger.js';
import { clip } from './schemas.js';
import type { SubagentRequest } from './reviewer.js';
import type { ReviewUnit, UnitScope } from './units.js';

/** A subagent a unit's reviewer asked for. */
export interface UnitRequest {
	unitId: string;
	unitTitle: string;
	request: SubagentRequest;
}

/**
 * The subagent stage as it stands, saved with the checkpoint. `units` is null
 * until the stage is planned, so a resumed review plans it only once. What
 * reviewers said about the brief's questions is kept with the questions.
 */
export interface SubagentState {
	requests: UnitRequest[];
	units: ReviewUnit[] | null;
	/** Requests past the cap, reported in the summary. */
	dropped: UnitRequest[];
}

/**
 * A copy of a saved state, with the fields a checkpoint written before they
 * existed lacks left empty. The question marks older checkpoints kept here are
 * dropped: those questions count as unanswered.
 */
export function restoreSubagentState(saved: Partial<SubagentState> | undefined): SubagentState {
	const { requests = [], units = null, dropped = [] } = structuredClone(saved ?? {});

	return { requests, units, dropped };
}

/**
 * A requested scope, cut down to hunks the review covers: files outside the
 * review (excluded, summarized, or outside the developer's instructions) and
 * unknown hunks are dropped, and a file named without hunks means all of them.
 * Falls back to `fallback` when nothing is left.
 */
function reviewableScope(requested: UnitScope, inventory: ReviewInventory, fallback: UnitScope): UnitScope {
	const scope = requested.flatMap((entry) => {
		const file = inventory.files.find((candidate) => candidate.path === entry.path);

		if (!file || file.excludeReason || file.summarize || !file.hunks.length) return [];

		const known = file.hunks.map((hunk) => hunk.id);
		const hunkIds = entry.hunkIds.filter((hunkId) => known.includes(hunkId));

		return [{ path: file.path, hunkIds: hunkIds.length ? hunkIds : known }];
	});

	return scope.length ? scope : fallback;
}

function sameConcern(a: string, b: string): boolean {
	return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

function overlaps(a: UnitScope, b: UnitScope): boolean {
	const hunks = new Set(a.flatMap((entry) => entry.hunkIds));

	return b.some((entry) => entry.hunkIds.some((hunkId) => hunks.has(hunkId)));
}

/**
 * Picks the subagents to run from every reviewer's requests, without a model:
 * requests go in unit order, one with the same concern as an earlier request
 * over overlapping hunks is merged into it, and the rest run up to `cap`. The
 * requests past the cap are returned as dropped; at cap 0 there are none to
 * report, since reviewers aren't offered subagents.
 */
export function planSubagents(
	requests: UnitRequest[],
	units: ReviewUnit[],
	inventory: ReviewInventory,
	cap: number
): { units: ReviewUnit[]; dropped: UnitRequest[] } {
	if (cap <= 0) return { units: [], dropped: [] };

	const order = (unitId: string) => units.findIndex((unit) => unit.id === unitId);
	const ordered = requests.map((entry, index) => ({ entry, index }));

	ordered.sort((a, b) => order(a.entry.unitId) - order(b.entry.unitId) || a.index - b.index);

	const unique: { entry: UnitRequest; scope: UnitScope }[] = [];

	for (const { entry } of ordered) {
		const fallback = units.find((unit) => unit.id === entry.unitId)?.scope ?? [];
		const scope = reviewableScope(entry.request.scope, inventory, fallback);

		const duplicate = unique.some(
			(kept) => sameConcern(kept.entry.request.concern, entry.request.concern) && overlaps(kept.scope, scope)
		);

		if (!duplicate && scope.length) unique.push({ entry, scope });
	}

	return {
		units: unique.slice(0, cap).map(({ entry, scope }, index) => ({
			id: `subagent-${index + 1}`,
			title: entry.request.concern,
			reason: `Asked by the reviewer of ${entry.unitTitle}: ${entry.request.question}\nWhy: ${entry.request.why}`,
			scope
		})),
		dropped: unique.slice(cap).map(({ entry }) => entry)
	};
}

/** What the brief and the review so far say about its open questions. */
export interface BriefPlanInput {
	questions: CodeClaim[];
	/** The stored questions, with every answer so far. */
	records: BriefQuestion[];
	/** The candidates as they stand, which decide whether a confirmation still holds. */
	candidates: CandidateFinding[];
}

/** A follow-up the plan made for an open question: the subagent sent to settle it, or why none was. */
export type PlannedFollowUp = BriefQuestionFollowUp & { question: CodeClaim };

/** An open question that could get a subagent, with the hunks it would start from. */
interface PlannedQuestion {
	question: CodeClaim;
	scope: UnitScope;
	/** How many reviewers left it unresolved. */
	marked: number;
	/** Whether some reviewer answered it, though nothing settled it. */
	answered: boolean;
}

/** The hunk holding the question's line, else what the unit covering its file reads of it; empty when the file isn't reviewed. */
function questionScope(
	question: CodeClaim,
	hunkId: string | undefined,
	units: ReviewUnit[],
	inventory: ReviewInventory
) {
	const covering = units.flatMap((unit) => unit.scope).find((entry) => entry.path === question.file);

	return reviewableScope(
		[{ path: question.file, hunkIds: hunkId ? [hunkId] : (covering?.hunkIds ?? []) }],
		inventory,
		[]
	);
}

/** The subagent already planned for an explicit request that covers the question: same hunks, and the same concern or a citation of it. */
function coveringRequest(question: CodeClaim, scope: UnitScope, requested: ReviewUnit[]): ReviewUnit | undefined {
	const cited = new RegExp(`\\b${question.id}\\b`);

	return requested.find(
		(unit) => overlaps(unit.scope, scope) && (sameConcern(unit.title, question.text) || cited.test(unit.reason))
	);
}

/**
 * The open questions that can be planned, in the brief's order, with a
 * follow-up for those that need no subagent of their own: one an explicit
 * request already covers, and one in code the review doesn't read. A question
 * a standing confirmation or a supported disproof settled is left out.
 */
function plannableQuestions(
	brief: BriefPlanInput,
	requested: ReviewUnit[],
	units: ReviewUnit[],
	inventory: ReviewInventory
): { plannable: PlannedQuestion[]; followUps: PlannedFollowUp[] } {
	const plannable: PlannedQuestion[] = [];
	const followUps: PlannedFollowUp[] = [];

	for (const question of brief.questions) {
		const record = brief.records.find((entry) => entry.id === question.id);

		if (record && questionStatus(record, brief.candidates).result !== 'unresolved') continue;

		const hunkId = hunkAt(inventory, question.file, question.line, 'new');
		const scope = questionScope(question, hunkId, units, inventory);
		const covering = scope.length ? coveringRequest(question, scope, requested) : undefined;

		if (!scope.length) followUps.push({ question, unitId: null, notRun: 'Its file is not among the code reviewed.' });
		else if (covering) followUps.push({ question, unitId: covering.id });
		else {
			plannable.push({
				question,
				scope,
				marked: record ? unsettledCount(record) : 0,
				answered: Boolean(record?.answers.length)
			});
		}
	}

	return { plannable, followUps };
}

/** The subagent for one brief question; `why` says why it was picked. */
function questionUnit({ question, scope }: PlannedQuestion, id: string, why: string): ReviewUnit {
	return {
		id,
		title: String(clip(question.text.replace(/\s+/g, ' ').trim(), 80)),
		reason: `Brief question ${question.id}, ${why}.\nQuestion: ${question.text}\nAt ${question.file}:${question.line}.`,
		scope
	};
}

/** Why an open question no reviewer left unresolved gets a subagent. */
function quietReason(entry: PlannedQuestion): string {
	return entry.answered ? 'no reviewer settled it with evidence' : 'no reviewer reported on it';
}

/**
 * Picks subagents for the brief's open questions, without a model, to fill
 * the `room` the explicit requests left under the cap. First the questions
 * reviewers left unresolved, the most marked first and ties in question
 * order; then the other open ones: unanswered, answered only by reviewers it
 * was outside the scope of, or reopened when the finding that confirmed it
 * fell. A settled question gets no subagent; where findings sit decides
 * nothing. A question an earlier request already covers is left out, and one
 * question gets at most one subagent. Ids continue after the `requested`
 * subagents. Every open question gets a follow-up: its subagent, or why none
 * could be planned.
 */
export function planBriefSubagents(
	brief: BriefPlanInput,
	requested: ReviewUnit[],
	units: ReviewUnit[],
	inventory: ReviewInventory,
	room: number
): { unsettled: ReviewUnit[]; unaddressed: ReviewUnit[]; followUps: PlannedFollowUp[] } {
	const { plannable, followUps } = plannableQuestions(brief, requested, units, inventory);
	const marked = plannable.filter((entry) => entry.marked > 0).sort((a, b) => b.marked - a.marked);
	const quiet = plannable.filter((entry) => !entry.marked);
	const free = Math.max(0, room);
	const nextId = (index: number) => `subagent-${requested.length + index + 1}`;

	const picked = [
		...marked
			.slice(0, free)
			.map((entry) => ({ entry, why: `marked unsettled by ${entry.marked} reviewer${entry.marked === 1 ? '' : 's'}` })),
		...quiet.slice(0, Math.max(0, free - marked.length)).map((entry) => ({ entry, why: quietReason(entry) }))
	].map(({ entry, why }, index) => ({ entry, unit: questionUnit(entry, nextId(index), why) }));

	const cut = plannable.filter((entry) => !picked.some((pick) => pick.entry === entry));

	return {
		unsettled: picked.filter(({ entry }) => entry.marked > 0).map(({ unit }) => unit),
		unaddressed: picked.filter(({ entry }) => !entry.marked).map(({ unit }) => unit),
		followUps: [
			...followUps,
			...picked.map(({ entry, unit }) => ({ question: entry.question, unitId: unit.id })),
			...cut.map(({ question }) => ({ question, unitId: null, notRun: 'No subagent was left under the cap for it.' }))
		]
	};
}
