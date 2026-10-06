import type { ObligationAnswer } from '@recoder/shared';
import { unitRecord, type ReviewUnit } from '../units.js';
import { finishedIds, poolContext, publishUnits, saveCheckpoint, type ReviewRun } from '../harness/context.js';
import { runOneUnit, runUnitPool } from '../harness/pool.js';
import { diffChanges } from '../harness/run-outcome.js';
import { deriveObligations, selectUnderCap } from './derive.js';
import { blankAnswer, investigate } from './investigate.js';
import { obligationUnit } from './prompts.js';

const TASK_ID = 'obligations';
const LABEL = 'Derive obligations';

/**
 * Derives the change's obligations once the change model exists, before any
 * lens runs, and queues an investigation for each one under the cap. Only
 * runs with `RECODER_OBLIGATIONS=1`, and once per review: a resume keeps the
 * saved list.
 */
export async function deriveObligationsStage(run: ReviewRun): Promise<void> {
	const state = run.obligations;

	if (!state || state.derived) return;

	const checkoutPath = run.input.revision?.checkoutPath ?? run.input.sandboxPath;

	if (!checkoutPath) {
		state.derived = [];
		state.skipped = 'the review has no local checkout';
		run.task(TASK_ID, LABEL, 'skipped', 'No local checkout to derive from', { kind: 'inventory' });

		return;
	}

	run.task(TASK_ID, LABEL, 'running', 'Scanning changed operations for risky changes', { kind: 'inventory' });

	try {
		state.derived = await deriveObligations({
			inventory: run.inventory,
			changeModel: run.changeModel,
			checkoutPath,
			baseSha: run.input.revision?.mergeBaseSha || null,
			signal: run.controller.signal
		});
	} catch (err) {
		if (run.controller.signal.aborted) return;

		state.derived = [];
		state.skipped = err instanceof Error ? err.message : String(err);
		run.task(TASK_ID, LABEL, 'error', 'Could not derive obligations', { kind: 'inventory' });

		return;
	}

	state.units = selectUnderCap(state.derived, state.cap).map(obligationUnit);

	for (const unit of state.units) {
		const record = unitRecord(unit, 'obligation');

		run.assignments.push(record);
		run.events?.onAssignment?.(record);
	}

	const message = `${state.derived.length} derived, ${state.units.length} to investigate (cap ${state.cap})`;

	run.task(TASK_ID, LABEL, 'done', message, { kind: 'inventory' });
	run.events?.onLog?.(`Obligations: ${message}.`);
	publishUnits(run, 1);
	saveCheckpoint(run);
}

/**
 * Runs the lens units and the investigations that have no answer yet through
 * one pool, investigations first, so together they never exceed its
 * concurrency. The model-call budget grows by each pending investigation's
 * turns. One the budget or deadline kept from starting is recorded as not
 * launched, so it still shows up as unresolved.
 */
export async function runUnitsWithObligations(run: ReviewRun, units: ReviewUnit[]): Promise<void> {
	const state = run.obligations!;
	const finished = finishedIds(run);
	const pending = state.units.filter((unit) => !finished.has(unit.id));
	const waiting = new Set(pending.map((unit) => unit.id));
	const ctx = poolContext(run);

	state.answers = state.answers.filter((answer) => !waiting.has(answer.obligationId));
	run.budget.limit += pending.length * state.maxTurns;

	const investigation = {
		...ctx,
		maxTurns: state.maxTurns,
		obligationOf: (id: string) => state.derived!.find((obligation) => obligation.id === id)!,
		workspace: run.workspace,
		mergeBaseSha: run.input.revision?.mergeBaseSha || null,
		changes: () => diffChanges(run.inventory, run.changeModel),
		onAnswer: (answer: ObligationAnswer) => state.answers.push(answer)
	};

	await runUnitPool([...pending, ...units], run.assignments, ctx, (item) =>
		waiting.has(item.id) ? investigate(item, run.assignments, investigation) : runOneUnit(item, run.assignments, ctx)
	);

	if (run.controller.signal.aborted) return;

	for (const unit of pending) {
		if (state.answers.some((answer) => answer.obligationId === unit.id)) continue;

		state.answers.push({
			obligationId: unit.id,
			...blankAnswer('unresolved', 'Not launched: budget or time reserved for consolidation'),
			turns: 0,
			elapsedMs: 0,
			tokens: null,
			maxTurns: state.maxTurns,
			launched: false
		});
	}
}
