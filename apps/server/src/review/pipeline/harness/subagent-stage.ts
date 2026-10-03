import { DEFAULT_SUBAGENT_CAP } from '@recoder/shared';
import { planSubagents, type UnitRequest } from '../subagents.js';
import { unitRecord } from '../units.js';
import { finishedIds, orchestratorSays, poolContext, publishUnits, saveCheckpoint, type ReviewRun } from './context.js';
import { runUnitPool } from './pool.js';

/**
 * Runs the subagents reviewers asked for, once every reviewer (and retry) has
 * answered, so the cap is applied in unit order rather than finishing order.
 * Planned once and saved, so a resume reruns only the subagents that didn't
 * finish. Subagents are never retried.
 */
export async function runSubagents(run: ReviewRun): Promise<void> {
	const state = run.subagents;

	if (!state.units) {
		const cap = run.input.subagentCap ?? DEFAULT_SUBAGENT_CAP;
		const plan = planSubagents(state.requests, run.units, run.inventory, cap);

		state.units = plan.units;
		state.dropped = plan.dropped;

		for (const unit of plan.units) {
			const record = unitRecord(unit, 'subagent');

			run.assignments.push(record);
			run.events?.onAssignment?.(record);
		}

		if (plan.units.length) {
			reportSubagents(run, plan.dropped, cap);
			publishUnits(run, 3);
		} else if (asksForSubagents(run.input.instructions)) {
			orchestratorSays(run.events, 'message_subagents', noSubagentsNote(cap));
		}

		saveCheckpoint(run);
	}

	const finished = finishedIds(run);
	const pending = state.units.filter((unit) => !finished.has(unit.id));

	if (!pending.length) return;

	run.events?.onStage?.('subagents');
	await runUnitPool(pending, run.assignments, poolContext(run));
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
function noSubagentsNote(cap: number): string {
	return cap
		? 'You asked for subagents, but no reviewer had an open question that needed one.'
		: 'You asked for subagents, but the Subagents setting is off. Turn it on under Settings › Harness and run the review again.';
}

/** The orchestrator's note on the subagents it's running, and any it left out over the cap. */
function reportSubagents(run: ReviewRun, dropped: UnitRequest[], cap: number): void {
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
