import type { Finding } from '@recoder/shared';
import { configForOrchestrator } from '../../../models/models.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { reviewNow } from '../../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError, runJsonAgent } from '../agent-loop.js';
import {
	applyConsolidation,
	consolidationSchema,
	consolidationSystemPrompt,
	consolidationUserPrompt,
	type CandidateFinding
} from '../consolidate.js';
import {
	orchestratorAgentOptions,
	orchestratorSays,
	publishCandidates,
	validCandidates,
	type ReviewRun
} from './context.js';
import type { TaskFn } from './types.js';

export interface Consolidated {
	confirmed: Finding[];
	/** The reviewers' recommended checks plus the orchestrator's. */
	checks: string[];
	error?: string;
}

/** Without this the review ends in silence and reads as if nothing ran. */
function announceNothingFound(run: ReviewRun): void {
	const count = run.assignments.length;

	orchestratorSays(
		run.events,
		'message_nothing_found',
		`${count === 1 ? 'The reviewer' : `All ${count} reviewers`} finished without reporting anything worth flagging.`
	);
}

/**
 * The consolidation stage: the orchestrator merges and confirms the valid
 * candidates in one reserved call. When that call can't run or answer, the
 * candidates stand as reported.
 */
export async function consolidate(run: ReviewRun): Promise<Consolidated> {
	const { task } = run;

	run.events?.onStage?.('consolidation');
	publishCandidates(run);

	const valid = validCandidates(run.candidates);
	const checks = [...run.recommended];

	task(
		'consolidation',
		'Consolidating findings',
		'running',
		`Consolidating ${valid.length} candidate${valid.length === 1 ? '' : 's'}`,
		{ kind: 'consolidation' }
	);

	if (valid.length === 0) {
		task('consolidation', 'Consolidating findings', 'done', 'No candidates to consolidate', {
			kind: 'consolidation'
		});

		announceNothingFound(run);

		return { confirmed: [], checks };
	}

	if (!run.budget.canSpend(1, { consumeReserve: true }) || reviewNow() >= run.deadlineAt) {
		const error = 'Reserved consolidation call was unavailable';

		return { confirmed: keepUnconsolidated(valid, error, task), checks, error };
	}

	try {
		return await askOrchestrator(run, valid, checks);
	} catch (err) {
		if (err instanceof ModelBlockedError) throw err;
		if (err instanceof ReviewAbortedError) throw err;

		const error = err instanceof Error ? err.message : 'Consolidation failed';

		return { confirmed: keepUnconsolidated(valid, error, task), checks, error };
	}
}

/** The orchestrator's single consolidation call over the valid candidates. */
async function askOrchestrator(run: ReviewRun, valid: CandidateFinding[], checks: string[]): Promise<Consolidated> {
	const { events, task } = run;
	const cfg = configForOrchestrator();

	const result = await runJsonAgent({
		label: 'consolidation',
		...orchestratorAgentOptions(run, cfg),
		system: withGuidelines(consolidationSystemPrompt(run.directive), run.inventory.guidelines),
		user: consolidationUserPrompt(valid, run.evidence),
		maxTurns: 1,
		deadlineAt: run.deadlineAt,
		consumeReserve: true,
		parse: (raw) => {
			const parsed = consolidationSchema.safeParse(raw);

			return parsed.success ? parsed.data : null;
		},
		onProgress: (state, elapsedMs, detail) =>
			task('consolidation', 'Consolidating findings', state === 'queued' ? 'waiting' : 'running', detail, {
				kind: 'consolidation',
				model: cfg.model,
				elapsedMs
			}),
		onLog: (message) => events?.onLog?.(message)
	});

	if (!result.value) {
		const error = result.error ?? 'Consolidation failed';

		return { confirmed: keepUnconsolidated(valid, error, task), checks, error };
	}

	const { confirmed } = applyConsolidation(result.value, valid);

	task(
		'consolidation',
		'Consolidating findings',
		'done',
		`Confirmed ${confirmed.length} finding${confirmed.length === 1 ? '' : 's'}`,
		{ kind: 'consolidation' }
	);

	return { confirmed, checks: [...checks, ...result.value.recommendedChecks] };
}

/**
 * Consolidation couldn't run or answer: the validated candidates stand as
 * findings, unmerged, so the review still finishes.
 */
export function keepUnconsolidated(valid: CandidateFinding[], reason: string, task: TaskFn): Finding[] {
	task(
		'consolidation',
		'Consolidating findings',
		'done',
		`Kept ${valid.length} finding${valid.length === 1 ? '' : 's'} as reported (${reason})`,
		{ kind: 'consolidation' }
	);

	return valid.map((candidate) => ({ ...candidate }));
}
