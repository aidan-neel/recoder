import { z } from 'zod';
import { configForOrchestrator } from '../../../models/models.js';
import { ModelBlockedError, ReviewAbortedError, runJsonAgent } from '../agent-loop.js';
import { orchestratorAgentOptions, type ReviewRun } from '../harness/context.js';
import { LENSES } from '../lenses/lenses.js';
import { patchChars, type ReviewUnit } from '../units.js';
import { SPECIALIST_CHILDREN } from './children.js';
import { KEPT_SPECIALISTS, type CoordinatorAnswer } from './specialist-plan.js';

const text = (max: number) => z.string().trim().max(max);

/**
 * The coordinator's reply. `dispatches` is required, so a reply that is not a plan (`{"findings":[]}`) takes the
 * no-plan fallback instead of reading as one that omits every optional specialist. A plan that leaves `omitted`
 * out omits nobody. Unknown specialists and slices are ignored by the plan, not rejected here.
 */
const coordinationSchema = z.object({
	dispatches: z
		.array(z.object({ specialist: text(40), slices: z.array(text(80)).max(50), question: text(600).default('') }))
		.max(40),
	omitted: z
		.array(z.object({ specialist: text(40), reason: text(600) }))
		.max(16)
		.default([])
});

const SYSTEM = `Role: coordinator of a specialist review tree. Each specialist reviewer applies one lens to the slices of a code change you give it. Decide which specialists read which slices, and the one question each should settle first.

Rules:
- Dispatch a specialist to every slice where its lens can find a defect. Omit one only when no slice can hold what it looks for, and give the reason.
- ${[...KEPT_SPECIALISTS].join(', ')} always read every slice they fit, whatever you answer; your question still steers them.
- Each specialist may later send up to ${SPECIALIST_CHILDREN} child investigators, each with a distinct question and code scope.

Reply with JSON only:
{"dispatches":[{"specialist":string,"slices":[string],"question":string}],"omitted":[{"specialist":string,"reason":string}]}`;

/**
 * Asks the orchestrator model, once, which specialists read which slices. A reply that is not a plan, a failed
 * call or a call the budget or deadline refused comes back as a failure with its reason; a blocked model or an
 * aborted review stops the review as everywhere else.
 */
export async function askCoordinator(run: ReviewRun, slices: ReviewUnit[]): Promise<CoordinatorAnswer> {
	const config = configForOrchestrator();

	try {
		const result = await runJsonAgent({
			stage: 'other',
			label: 'Specialist coordinator',
			...orchestratorAgentOptions(run, config),
			system: SYSTEM,
			user: coordinatorPrompt(run, slices),
			maxTurns: 1,
			deadlineAt: run.investigationDeadline,
			parse: (raw) => {
				const parsed = coordinationSchema.safeParse(raw);

				return parsed.success ? parsed.data : null;
			},
			onLog: (message) => run.events?.onLog?.(message)
		});

		return result.value ? { coordination: result.value } : { failure: result.error ?? 'no plan in the reply' };
	} catch (err) {
		if (err instanceof ReviewAbortedError || err instanceof ModelBlockedError) throw err;

		return { failure: err instanceof Error ? err.message : String(err) };
	}
}

/** The change's title, the specialists with what each reports, and each slice with its files and the lenses that fit it. */
function coordinatorPrompt(run: ReviewRun, slices: ReviewUnit[]): string {
	const specialists = LENSES.map((lens) => `- ${lens.id}: ${lens.title} (reports ${lens.categories.join(', ')})`);

	const described = slices.map((slice) => {
		const files = slice.scope.map(
			(entry) => `${entry.path} (${entry.hunkIds.length} hunks, ${patchChars(run.inventory, entry)} characters)`
		);

		return `- ${slice.id}, fits ${(slice.lenses ?? []).join(', ')}: ${files.join('; ')}`;
	});

	return [
		`Change: ${run.input.prTitle ?? '(no title)'}`,
		'',
		'Specialists:',
		...specialists,
		'',
		'Slices:',
		...described
	].join('\n');
}
