import { BUG_CATEGORIES } from '@recoder/shared';
import type { ReviewRun } from '../harness/context.js';
import { selectionReports } from '../lenses/lenses.js';
import { reviewerSlices, type ReviewUnit } from '../units.js';
import { coChanges, type CoChange } from './co-change.js';
import { contractCheckCap, contractChecksOn, residualCap, residualOn } from './config.js';
import { contractCheckUnits, residualUnits } from './plan.js';

/** The categories a contract check reports a defect in. */
const CONTRACT_CATEGORIES = ['correctness', 'api-contract', 'intent-mismatch'];

/**
 * Where an unchanged file's co-change history is read from, as the change
 * model reads its files; absent without a local checkout or merge base.
 */
function historySource(run: ReviewRun): { checkoutPath: string; baseSha: string } | null {
	const checkoutPath = run.input.revision?.checkoutPath ?? run.input.sandboxPath;
	const baseSha = run.input.revision?.mergeBaseSha;

	return checkoutPath && baseSha ? { checkoutPath, baseSha } : null;
}

/** Each unit's co-change hints by unit id; empty when there is no history to read. */
async function coChangeHints(run: ReviewRun, slices: ReviewUnit[]): Promise<Map<string, CoChange[]>> {
	const source = historySource(run);

	if (!source) return new Map();

	const changed = new Set(
		run.inventory.files.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path]))
	);

	const entries = await Promise.all(
		slices.map(async (slice) => {
			const files = slice.scope.flatMap((entry) => {
				const file = run.inventory.files.find((candidate) => candidate.path === entry.path);

				return file ? [{ path: file.path, oldPath: file.oldPath, added: file.status === 'added' }] : [];
			});

			const hints = await coChanges({ ...source, files, changed, signal: run.controller.signal });

			return [slice.id, hints] as const;
		})
	);

	return new Map(entries);
}

/**
 * The second-look subagents the harness sends once the reviewers have answered,
 * on the second model: a residual pass per reviewer slice (`RECODER_RESIDUAL=1`)
 * and a contract check per readability report of a comment that disagrees with
 * the code (`RECODER_CONTRACT_CHECKS=1`). Empty with both off. They share the
 * subagent cap with the subagents reviewers asked for, so they take only the
 * `room` those left under it. A review that applies only some lenses sends only those that could report
 * something it applies: a residual pass needs a lens that reports bugs, a contract check one that reports
 * the categories it decides in.
 */
export async function planSecondLook(run: ReviewRun, room: number): Promise<ReviewUnit[]> {
	const residualRoom = Math.max(0, Math.min(residualCap(), room));
	const selection = run.input.lenses;
	const sendsResidual = residualOn() && selectionReports(selection, BUG_CATEGORIES);
	const slices = sendsResidual ? reviewerSlices(run.units).slice(0, residualRoom) : [];
	const hints = slices.length ? await coChangeHints(run, slices) : new Map<string, CoChange[]>();
	const passes = residualUnits(slices, run.candidates, hints, residualRoom);
	const checkRoom = Math.max(0, Math.min(contractCheckCap(), room - passes.length));
	const sendsChecks = contractChecksOn() && selectionReports(selection, CONTRACT_CATEGORIES);
	const checks = sendsChecks ? contractCheckUnits(run.candidates, run.inventory, checkRoom) : [];

	return [...passes, ...checks];
}
