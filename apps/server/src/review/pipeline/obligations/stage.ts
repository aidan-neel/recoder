import type { ObligationAnswer } from '@recoder/shared';
import { unitRecord } from '../units.js';
import { finishedIds, poolContext, publishUnits, saveCheckpoint, type ReviewRun } from '../harness/context.js';
import { runUnitPool } from '../harness/pool.js';
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
 * Runs the investigations that have no answer yet, alongside the lens
 * reviewers, through the same pool. The model-call budget grows by what they
 * may spend, so they never starve the lenses. One the budget or deadline kept
 * from starting is recorded as not launched, so it still shows up as unresolved.
 */
export async function runObligations(run: ReviewRun): Promise<void> {
	const state = run.obligations;

	if (!state?.units.length) return;

	const finished = finishedIds(run);
	const pending = state.units.filter((unit) => !finished.has(unit.id));
	const waiting = new Set(pending.map((unit) => unit.id));

	if (!pending.length) return;

	state.answers = state.answers.filter((answer) => !waiting.has(answer.obligationId));
	run.budget.limit += pending.length * state.maxTurns;

	const ctx = {
		...poolContext(run),
		maxTurns: state.maxTurns,
		obligationOf: (id: string) => state.derived!.find((obligation) => obligation.id === id)!,
		workspace: run.workspace,
		mergeBaseSha: run.input.revision?.mergeBaseSha || null,
		onAnswer: (answer: ObligationAnswer) => state.answers.push(answer)
	};

	await runUnitPool(pending, run.assignments, ctx, (item) => investigate(item, run.assignments, ctx));

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
