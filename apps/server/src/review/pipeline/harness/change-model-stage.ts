import { buildChangeModel } from '../change-model/change-model.js';
import type { ReviewRun } from './context.js';

const TASK_ID = 'change-model';
const LABEL = 'Map changed code';

/**
 * Builds the deterministic change model from the PR head checkout. It never
 * fails the review: without a checkout, or when parsing fails, the model stays
 * null and lenses fall back to the raw patch.
 */
export async function changeModelStage(run: ReviewRun): Promise<void> {
	const { input, events, task } = run;
	const checkoutPath = input.revision?.checkoutPath ?? input.sandboxPath;

	if (!checkoutPath) {
		task(TASK_ID, LABEL, 'skipped', 'No local checkout to parse', { kind: 'inventory' });
		events?.onLog?.('Change model skipped: the review has no local checkout.');

		return;
	}

	task(TASK_ID, LABEL, 'running', 'Parsing changed declarations', { kind: 'inventory' });

	const started = Date.now();

	try {
		run.changeModel = await buildChangeModel({
			inventory: run.inventory,
			checkoutPath,
			signal: run.controller.signal,
			baseSha: input.revision?.mergeBaseSha || undefined
		});

		const count = run.changeModel.symbols.length;
		const unparsed = run.changeModel.unparsed.length;
		const extra = unparsed ? `; ${unparsed} file${unparsed === 1 ? '' : 's'} without a parser` : '';

		task(TASK_ID, LABEL, 'done', `Mapped ${count} changed declaration${count === 1 ? '' : 's'}${extra}`, {
			kind: 'inventory',
			elapsedMs: Date.now() - started
		});
	} catch (err) {
		run.changeModel = null;

		const message = err instanceof Error ? err.message : String(err);

		task(TASK_ID, LABEL, 'error', 'Could not map the changed code; reviewing from the patch', { kind: 'inventory' });
		events?.onLog?.(`Change model failed: ${message}`);
	}
}
