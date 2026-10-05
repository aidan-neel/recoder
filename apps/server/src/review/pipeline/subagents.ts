import { hunkAt } from './harness/findings.js';
import type { CodeClaim } from './intent/types.js';
import type { ReviewInventory } from './inventory.js';
import type { QuestionAnswer } from './reviewer-questions.js';
import { clip } from './schemas.js';
import type { SubagentRequest } from './reviewer.js';
import type { ReviewUnit, UnitScope } from './units.js';

/** A subagent a unit's reviewer asked for. */
export interface UnitRequest {
	unitId: string;
	unitTitle: string;
	request: SubagentRequest;
}

/** One lens assignment's note that it could not settle one of the brief's open questions. */
export interface UnsettledMark {
	/** The brief's id for the question (`Q3`). */
	questionId: string;
	/** The lens assignment that marked it. */
	unitId: string;
}

/** One lens assignment's explicit answer to one of the brief's open questions. */
export interface AnsweredMark {
	/** The brief's id for the question (`Q3`). */
	questionId: string;
	/** The lens assignment that answered it. */
	unitId: string;
	/** `confirmed` when the reviewer reported it as a finding, `disproved` when it found the code fine. */
	outcome: QuestionAnswer['outcome'];
}

/**
 * The subagent stage as it stands, saved with the checkpoint. `units` is null
 * until the stage is planned, so a resumed review plans it only once.
 */
export interface SubagentState {
	requests: UnitRequest[];
	/** Brief questions reviewers marked unsettled, in the order they finished. */
	unsettled: UnsettledMark[];
	/** Brief questions reviewers answered, in the order they finished. */
	answered: AnsweredMark[];
	units: ReviewUnit[] | null;
	/** Requests past the cap, reported in the summary. */
	dropped: UnitRequest[];
}

function emptySubagentState(): SubagentState {
	return { requests: [], unsettled: [], answered: [], units: null, dropped: [] };
}

/** A copy of a saved state, with the fields a checkpoint written before they existed lacks left empty. */
export function restoreSubagentState(saved: Partial<SubagentState> | undefined): SubagentState {
	return { ...emptySubagentState(), ...structuredClone(saved ?? {}) };
}

/** The ids of the brief questions a unit was shown. */
function shownIds(shown: CodeClaim[]): Set<string> {
	return new Set(shown.map((question) => question.id));
}

/**
 * Keeps the open questions `unitId` marked unsettled, once each. An id that
 * isn't among the questions its brief showed it is dropped.
 */
export function recordUnsettled(marks: UnsettledMark[], unitId: string, ids: string[], shown: CodeClaim[]): void {
	const known = shownIds(shown);

	for (const questionId of ids) {
		const seen = marks.some((mark) => mark.questionId === questionId && mark.unitId === unitId);

		if (known.has(questionId) && !seen) marks.push({ questionId, unitId });
	}
}

/**
 * Keeps the open questions `unitId` answered, once each. An answer for a
 * question its brief didn't show it is dropped.
 */
export function recordAnswered(
	marks: AnsweredMark[],
	unitId: string,
	answers: QuestionAnswer[],
	shown: CodeClaim[]
): void {
	const known = shownIds(shown);

	for (const { questionId, outcome } of answers) {
		const seen = marks.some((mark) => mark.questionId === questionId && mark.unitId === unitId);

		if (known.has(questionId) && !seen) marks.push({ questionId, unitId, outcome });
	}
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
	marks: UnsettledMark[];
	answers: AnsweredMark[];
}

/** An open question that could get a subagent, with the hunks it would start from. */
interface PlannedQuestion {
	question: CodeClaim;
	scope: UnitScope;
	/** How many lens assignments marked it unsettled. */
	marked: number;
	/** Whether some lens assignment answered it. */
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

/** Whether a subagent already planned for an explicit request covers the question: same hunks, and the same concern or a citation of it. */
function coveredByRequest(question: CodeClaim, scope: UnitScope, requested: ReviewUnit[]): boolean {
	const cited = new RegExp(`\\b${question.id}\\b`);

	return requested.some(
		(unit) => overlaps(unit.scope, scope) && (sameConcern(unit.title, question.text) || cited.test(unit.reason))
	);
}

/** The questions that can be planned, in the brief's order: not already asked about, and in code the review reads. */
function plannableQuestions(
	brief: BriefPlanInput,
	requested: ReviewUnit[],
	units: ReviewUnit[],
	inventory: ReviewInventory
): PlannedQuestion[] {
	return brief.questions.flatMap((question) => {
		const hunkId = hunkAt(inventory, question.file, question.line, 'new');
		const scope = questionScope(question, hunkId, units, inventory);

		if (!scope.length || coveredByRequest(question, scope, requested)) return [];

		const markers = new Set(brief.marks.filter((mark) => mark.questionId === question.id).map((mark) => mark.unitId));
		const answered = brief.answers.some((answer) => answer.questionId === question.id);

		return [{ question, scope, marked: markers.size, answered }];
	});
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

/**
 * Picks subagents for the brief's open questions, without a model, to fill
 * the `room` the explicit requests left under the cap. First the questions
 * reviewers marked unsettled, the most marked first and ties in question
 * order; then the unaddressed ones: no reviewer marked it unsettled and none
 * answered it. A question some reviewer answered and none marked unsettled is
 * settled and gets no subagent; where findings sit decides nothing. A question
 * an earlier request already covers is left out, and one question gets at most
 * one subagent. Ids continue after the `requested` subagents.
 */
export function planBriefSubagents(
	brief: BriefPlanInput,
	requested: ReviewUnit[],
	units: ReviewUnit[],
	inventory: ReviewInventory,
	room: number
): { unsettled: ReviewUnit[]; unaddressed: ReviewUnit[] } {
	if (room <= 0) return { unsettled: [], unaddressed: [] };

	const plannable = plannableQuestions(brief, requested, units, inventory);
	const marked = plannable.filter((entry) => entry.marked > 0).sort((a, b) => b.marked - a.marked);

	const quiet = plannable.filter((entry) => !entry.marked && !entry.answered);

	const nextId = (index: number) => `subagent-${requested.length + index + 1}`;

	const unsettled = marked
		.slice(0, room)
		.map((entry, index) =>
			questionUnit(entry, nextId(index), `marked unsettled by ${entry.marked} reviewer${entry.marked === 1 ? '' : 's'}`)
		);

	const unaddressed = quiet
		.slice(0, room - unsettled.length)
		.map((entry, index) => questionUnit(entry, nextId(unsettled.length + index), 'no reviewer reported on it'));

	return { unsettled, unaddressed };
}
