import { makeSource, sortSources } from '../../../forge/context/sources.js';
import { distillIntent } from '../intent/distill.js';
import { gatherHistory } from '../intent/history.js';
import type { ChangeIntent, IntentSource } from '../intent/types.js';
import { publishBudget, type ReviewRun } from './context.js';

const TASK = { id: 'intent', label: 'Reading what the change is for' } as const;

/**
 * The gathered sources, plus the title and description the review was given
 * when gathering found no PR source: a local review, or a host that didn't answer.
 */
function ownSources(run: ReviewRun): IntentSource[] {
	const { context, prTitle, prBody } = run.input;
	const gathered = context?.sources ?? [];

	if (gathered.some((source) => source.kind === 'pr') || (!prTitle?.trim() && !prBody?.trim())) return gathered;

	return [makeSource({ kind: 'pr', ref: 'pr', title: prTitle ?? undefined, text: prBody ?? '' }), ...gathered];
}

function describe(intent: ChangeIntent | null, sources: number): string {
	if (!intent) return sources ? `Nothing distilled from ${sources} source${sources === 1 ? '' : 's'}` : 'No context';

	const claims = [
		intent.goals,
		intent.acceptanceCriteria,
		intent.statedConstraints,
		intent.nonGoals,
		intent.priorDecisions,
		intent.observedChanges,
		intent.openQuestions
	].flat().length;

	const all = intent.units ?? [];
	const count = (status: string) => all.filter((unit) => unit.status === status).length;
	const partial = count('partial') ? `, ${count('partial')} clipped` : '';
	const omitted = count('omitted') ? `, ${count('omitted')} left out` : '';
	const units = all.length ? `, ${count('included')} of ${all.length} units briefed${partial}${omitted}` : '';

	return `${claims} claim${claims === 1 ? '' : 's'} from ${sources} source${sources === 1 ? '' : 's'}${units}`;
}

/** One log line per unit the brief read or left out, and how long the stage took, so an omission is never silent. */
function logBrief(run: ReviewRun, intent: ChangeIntent | null, startedAt: number): void {
	for (const unit of intent?.units ?? []) {
		const why = unit.reason ? ` (${unit.reason}: ${unit.detail})` : '';

		run.events?.onLog?.(`Brief ${unit.id} ${unit.title}: ${unit.status}${why}`);
	}

	run.events?.onLog?.(`Intent stage took ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

/**
 * The intent stage, after the change model: the gathered PR context plus the
 * history of the modified symbols, distilled into what the change is meant to
 * do. Never throws: without intent the review still runs, just without it.
 */
export async function intentStage(run: ReviewRun): Promise<void> {
	const { task, input } = run;
	const signal = run.controller.signal;
	const startedAt = Date.now();

	task(TASK.id, TASK.label, 'running', 'Gathering the PR, its issues and history', { kind: 'planning' });

	try {
		const history = input.revision
			? await gatherHistory({
					model: run.changeModel,
					checkoutPath: input.revision.checkoutPath,
					prsForCommit: input.prsForCommit,
					signal,
					headSha: input.revision.headSha,
					mergeBaseSha: input.revision.mergeBaseSha
				})
			: [];

		const sources = sortSources([...ownSources(run), ...history]);
		const stack = input.context?.stack ?? { parent: null, children: [] };

		run.intent = await distillIntent(run, sources, stack);
		logBrief(run, run.intent, startedAt);
		task(TASK.id, TASK.label, 'done', describe(run.intent, sources.length), { kind: 'planning' });
	} catch (err) {
		run.intent = null;

		task(TASK.id, TASK.label, 'done', `Skipped: ${err instanceof Error ? err.message : String(err)}`, {
			kind: 'planning'
		});
	}

	publishBudget(run);
}
