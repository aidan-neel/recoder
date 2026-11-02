import { DEFAULT_SUBAGENT_CAP, type SubagentCap } from '@recoder/shared';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { questionRecord } from '../question-ledger.js';
import { planSecondLook } from '../second-look/stage.js';
import { planBriefSubagents, planSubagents, type UnitRequest } from '../subagents.js';
import { unitRecord, type ReviewUnit } from '../units.js';
import {
	extendDeadlines,
	finishedIds,
	orchestratorSays,
	poolContext,
	publishUnits,
	saveCheckpoint,
	type ReviewRun
} from './context.js';
import { runUnitPool } from './pool.js';

/** Model calls one subagent or second look can make: each turn, plus the repair calls a failed or malformed turn takes. */
function subagentCalls(run: ReviewRun): number {
	return run.limits.subagentTurns + REVIEW_POLICY.schemaRepairAttempts;
}

/**
 * Runs the subagents, once every reviewer (and retry) has answered, so the cap
 * is applied in unit order rather than finishing order. Reviewers' requests
 * come first, then the brief's open questions they left unresolved, then
 * the other questions nothing settled, until the cap ({@link subagentLimit})
 * is reached; each open question keeps its follow-up, or why it got none. A
 * request runs whether or not the first pass raised a finding: a reviewer asks
 * because it could not settle a doubt, which is where a miss hides. With
 * subagents off, none runs and no request is reported dropped. The second
 * looks the flags turn on come after them, outside the cap, each bringing its
 * own model calls and time. Planned once and saved, so a resume reruns only
 * the subagents that didn't finish. Subagents are never retried.
 */
export async function runSubagents(run: ReviewRun): Promise<void> {
	const state = run.subagents;

	if (!state.units) {
		const cap = run.input.subagentCap ?? DEFAULT_SUBAGENT_CAP;
		const limit = subagentLimit(run, cap);

		const plan =
			cap === 0 ? { units: [], dropped: [] } : planSubagents(state.requests, run.units, run.inventory, limit);

		const brief = { questions: run.intent?.openQuestions ?? [], records: run.questions, candidates: run.candidates };
		const fromBrief = planBriefSubagents(brief, plan.units, run.units, run.inventory, limit - plan.units.length);

		for (const { question, ...followUp } of fromBrief.followUps) {
			questionRecord(run.questions, question).followUps.push(followUp);
		}

		const secondLook = await planSecondLook(run);

		state.units = [...plan.units, ...fromBrief.unsettled, ...fromBrief.unaddressed, ...secondLook];
		state.dropped = plan.dropped;

		run.events?.onLog?.(
			`Planned ${state.units.length} subagents (cap ${capText(cap, limit)}): ${plan.units.length} from reviewer requests, ${fromBrief.unsettled.length} from unsettled brief questions, ${fromBrief.unaddressed.length} from unaddressed brief questions, ${secondLook.length} second looks outside the cap.`
		);

		for (const unit of state.units) {
			const record = unitRecord(unit, 'subagent');

			run.assignments.push(record);
			run.events?.onAssignment?.(record);
		}

		if (state.units.length) {
			reportSubagents(run, plan.dropped, capText(cap, limit));
			publishUnits(run, 3);
		} else if (asksForSubagents(run.input.instructions)) {
			orchestratorSays(run.events, 'message_subagents', noSubagentsNote(cap));
		}

		saveCheckpoint(run);
	}

	const finished = finishedIds(run);
	const pending = state.units.filter((unit) => !finished.has(unit.id));

	if (!pending.length) return;

	makeRoomForSecondLooks(run, pending);
	run.events?.onStage?.('subagents');
	await runUnitPool(pending, run.assignments, poolContext(run));
}

/**
 * The most subagents this review plans: the setting, or with it uncapped, as
 * many as the model calls left can pay for in full once the consolidation
 * reserve and the calls verifiers still in line were given are held back, so
 * subagents never spend a verifier's share. Time bounds them too: none
 * launches past the investigation deadline, which keeps the verifiers' reserve.
 */
function subagentLimit(run: ReviewRun, cap: SubagentCap | number): number {
	if (cap !== 'uncapped') return cap;

	const free = run.budget.remaining() - run.budget.reserve - (run.verifying?.heldCalls ?? 0);

	return Math.max(0, Math.floor(free / subagentCalls(run)));
}

/** The cap as the orchestrator words it: the setting, or with it uncapped, how many the budget had room for. */
function capText(cap: SubagentCap | number, limit: number): string {
	return cap === 'uncapped' ? `${limit}, all the review's model calls had room for` : String(cap);
}

/**
 * Each second look brings its own model calls. A residual pass rereads a
 * whole unit and starts once every lens and investigation has answered, often
 * late on the review's clock, so the deadline moves out to fit its whole
 * clock; a contract check is short and fits in the time left.
 */
function makeRoomForSecondLooks(run: ReviewRun, pending: ReviewUnit[]): void {
	run.budget.limit += pending.filter((unit) => unit.purpose).length * subagentCalls(run);

	if (!pending.some((unit) => unit.purpose === 'residual')) return;

	const short =
		reviewNow() + REVIEW_POLICY.secondLookMaxMs + REVIEW_POLICY.reserveMsForConsolidation - run.investigationDeadline;

	if (short > 0) extendDeadlines(run, short);
}

/**
 * The developer's latest words mention subagents ("this time use subagents").
 * The brief is every message they sent, newest last, so an older question
 * ("did you run subagents?") doesn't count on a later run.
 */
function asksForSubagents(instructions: string | null | undefined): boolean {
	return /\bsub-?agents?\b/i.test(instructions?.split('\n\n').at(-1) ?? '');
}

/** Why a brief that asked for subagents got none. */
function noSubagentsNote(cap: SubagentCap | number): string {
	return cap
		? 'You asked for subagents, but no reviewer had an open question that needed one.'
		: 'You asked for subagents, but the Subagents setting is off. Turn it on under Settings › Harness and run the review again.';
}

/** The orchestrator's note on the subagents it's running, and any it left out over the cap. */
function reportSubagents(run: ReviewRun, dropped: UnitRequest[], cap: string): void {
	const units = run.subagents.units ?? [];
	const lines = units.map((unit) => `- **${unit.title}**: ${unit.reason.split('\n')[0]}`);

	const skipped = dropped.length
		? `\n\nSkipped ${dropped.length} more over the limit of ${cap}: ${dropped.map((entry) => entry.request.concern).join(', ')}.`
		: '';

	orchestratorSays(
		run.events,
		'message_subagents',
		`I'm running ${units.length === 1 ? 'a subagent' : `${units.length} subagents`} for a closer look:\n\n${lines.join('\n')}${skipped}`
	);
}

/** The summary's sentence on requests past the cap, empty when none were dropped. */
export function droppedSentence(dropped: UnitRequest[]): string {
	if (!dropped.length) return '';

	const concerns = dropped.map((entry) => `${entry.request.concern} (${entry.unitTitle})`).join('; ');

	return `${dropped.length === 1 ? 'One subagent request' : `${dropped.length} subagent requests`} went over the limit and did not run: ${concerns}.`;
}
