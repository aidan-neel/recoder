import { LENSES, lensById } from '../lenses/lenses.js';
import type { LensId } from '../lenses/types.js';
import { unitTitle, type ReviewUnit, type UnitScope } from '../units.js';

/**
 * Specialists the tree keeps over every slice they fit, whatever the coordinator says, so the tree never
 * reviews correctness, security, concurrency, API contracts or repository rules less than the baseline (issue #95).
 */
const KEPT_SPECIALISTS: ReadonlySet<LensId> = new Set([
	'correctness',
	'security',
	'concurrency',
	'api-contract',
	'rules'
]);

/** The id of a specialist's reviewer unit: `specialist-security`. */
const SPECIALIST_PREFIX = 'specialist-';

/** Whether the review's units are a specialist tree's, planned already. */
export function isSpecialistTree(units: ReviewUnit[]): boolean {
	return units.some((unit) => unit.id.startsWith(SPECIALIST_PREFIX));
}

/** What the coordinator answered: the slices each specialist reads with the question it asks, and who it left out. */
export interface Coordination {
	dispatches: { specialist: string; slices: string[]; question: string }[];
	omitted: { specialist: string; reason: string }[];
}

/** The coordinator's answer, or why it gave none. */
export type CoordinatorAnswer = { coordination: Coordination } | { failure: string };

/**
 * What became of one specialist: `dispatched` as the coordinator asked, `kept` over every slice it fits although
 * the coordinator narrowed or omitted it (or gave no plan), `omitted` with no unit at all.
 */
export interface DispatchDecision {
	specialist: LensId;
	outcome: 'dispatched' | 'kept' | 'omitted';
	/** The slices (`reviewer-1`…) it reads, in slice order; empty when omitted. */
	slices: string[];
	/** The coordinator's question for it, empty when it asked none. */
	question: string;
	reason: string;
}

/** A slice a specialist fits but does not read, because the coordinator did not give it the slice. */
interface UnassignedTask {
	specialist: LensId;
	slice: string;
	reason: string;
}

/** The specialist tree: one reviewer unit per specialist that runs, and every decision and task left unassigned. */
export interface SpecialistPlan {
	units: ReviewUnit[];
	decisions: DispatchDecision[];
	unassigned: UnassignedTask[];
}

/**
 * Turns the coordinator's answer into the specialists that review the change, without a model call. Each
 * specialist is one lens over the slices it was given; a kept specialist always reads every slice it fits; a slice
 * the plan leaves with no reader goes to the first specialist that fits it, so every changed line is still read.
 * Specialists and slices the coordinator named that do not exist, or that a specialist does not fit, are ignored.
 */
export function planSpecialists(slices: ReviewUnit[], answer: CoordinatorAnswer): SpecialistPlan {
	const drafts = LENSES.map((lens) => lens.id)
		.map((id) => ({ id, fitting: slices.filter((slice) => slice.lenses?.includes(id)).map((slice) => slice.id) }))
		.filter((entry) => entry.fitting.length > 0)
		.map((entry) => decide(entry.id, entry.fitting, answer));

	const decisions = givingEverySliceAReader(
		drafts.map((draft) => draft.decision),
		slices
	);

	const unassigned = drafts
		.flatMap((draft) => draft.unassigned)
		.filter(
			(task) => !decisions.some((entry) => entry.specialist === task.specialist && entry.slices.includes(task.slice))
		);

	return { units: decisions.flatMap((decision) => unitOf(decision, slices)), decisions, unassigned };
}

/** What the coordinator asked of one specialist: the slices it fits, those it was given, its question and why it was left out. */
interface SpecialistAsk {
	specialist: LensId;
	fitting: string[];
	asked: string[];
	question: string;
	omission: string | undefined;
}

type Draft = { decision: DispatchDecision; unassigned: UnassignedTask[] };

/** One specialist's decision and the slices it fits but was not given. */
function decide(specialist: LensId, fitting: string[], answer: CoordinatorAnswer): Draft {
	if ('failure' in answer) {
		const reason = `The coordinator gave no plan (${answer.failure}), so it reads every slice it fits.`;

		return { decision: { specialist, outcome: 'kept', slices: fitting, question: '', reason }, unassigned: [] };
	}

	const ask = askOf(specialist, fitting, answer.coordination);

	return KEPT_SPECIALISTS.has(specialist) ? { decision: keptDecision(ask), unassigned: [] } : optionalDraft(ask);
}

function askOf(specialist: LensId, fitting: string[], coordination: Coordination): SpecialistAsk {
	const dispatches = coordination.dispatches.filter((entry) => entry.specialist === specialist);
	const named = new Set(dispatches.flatMap((entry) => entry.slices));

	return {
		specialist,
		fitting,
		asked: fitting.filter((slice) => named.has(slice)),
		question: dispatches
			.map((entry) => entry.question)
			.filter(Boolean)
			.join(' '),
		omission: coordination.omitted.find((entry) => entry.specialist === specialist)?.reason
	};
}

/** A specialist the tree always keeps: as dispatched when the coordinator gave it every slice it fits, else widened to them. */
function keptDecision({ specialist, fitting, asked, question, omission }: SpecialistAsk): DispatchDecision {
	if (asked.length === fitting.length) {
		return { specialist, outcome: 'dispatched', slices: fitting, question, reason: 'Dispatched by the coordinator.' };
	}

	const narrowed = asked.length
		? `The coordinator gave it only ${asked.join(', ')}`
		: `The coordinator omitted it: ${omission ?? 'it gave no reason'}`;

	return {
		specialist,
		outcome: 'kept',
		slices: fitting,
		question,
		reason: `${narrowed}. The tree always keeps this specialist over every slice it fits.`
	};
}

/** Any other specialist: dispatched over the slices it was given, or omitted, with each slice it fits but did not get left unassigned. */
function optionalDraft({ specialist, fitting, asked, question, omission }: SpecialistAsk): Draft {
	const why = asked.length
		? 'The coordinator did not give this slice to it.'
		: `The coordinator omitted it: ${omission ?? 'it gave no reason'}.`;

	const unassigned = fitting
		.filter((slice) => !asked.includes(slice))
		.map((slice) => ({ specialist, slice, reason: why }));

	if (!asked.length)
		return { decision: { specialist, outcome: 'omitted', slices: [], question, reason: why }, unassigned };

	return {
		decision: { specialist, outcome: 'dispatched', slices: asked, question, reason: 'Dispatched by the coordinator.' },
		unassigned
	};
}

/** The decisions with every slice no specialist reads handed to the first specialist that fits it. */
function givingEverySliceAReader(decisions: DispatchDecision[], slices: ReviewUnit[]): DispatchDecision[] {
	const order = (slice: string) => slices.findIndex((entry) => entry.id === slice);

	return slices.reduce((current, slice) => {
		const read = current.some((decision) => decision.slices.includes(slice.id));
		const first = slice.lenses?.[0];

		if (read || !first) return current;

		return current.map((decision): DispatchDecision =>
			decision.specialist === first
				? {
						...decision,
						outcome: 'kept',
						slices: [...decision.slices, slice.id].sort((a, b) => order(a) - order(b)),
						reason: `${decision.reason} The coordinator left ${slice.id} with no specialist, and this is the first one that fits it.`
					}
				: decision
		);
	}, decisions);
}

/** The reviewer unit of a specialist that runs: its one lens over the hunks of its slices, with the coordinator's question. */
function unitOf(decision: DispatchDecision, slices: ReviewUnit[]): ReviewUnit[] {
	if (decision.outcome === 'omitted') return [];

	const scope = mergedScope(slices.filter((slice) => decision.slices.includes(slice.id)).map((slice) => slice.scope));
	const question = decision.question ? ` Coordinator's question: ${decision.question}` : '';

	return [
		{
			id: `${SPECIALIST_PREFIX}${decision.specialist}`,
			title: `Specialist ${lensById(decision.specialist).title} · ${unitTitle(scope)}`,
			reason: `Reads ${decision.slices.join(', ')} as the ${decision.specialist} specialist and applies only that lens. ${decision.reason}${question}`,
			scope,
			lenses: [decision.specialist]
		}
	];
}

/** The scopes as one, in order, with the hunks of a file that two slices split joined into one entry. */
function mergedScope(scopes: UnitScope[]): UnitScope {
	const merged: UnitScope = [];

	for (const entry of scopes.flat()) {
		const same = merged.find((kept) => kept.path === entry.path);

		if (same) same.hunkIds.push(...entry.hunkIds.filter((hunkId) => !same.hunkIds.includes(hunkId)));
		else merged.push({ path: entry.path, hunkIds: [...entry.hunkIds] });
	}

	return merged;
}
