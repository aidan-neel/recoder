import { EvidenceStore } from '../../src/evidence/evidence';
import type { ModelConfig } from '../../src/models/models';
import { ModelBudget } from '../../src/review/pipeline/agent-loop/budget';
import type { JsonAgentOptions } from '../../src/review/pipeline/agent-loop/options';
import { buildInventory } from '../../src/review/pipeline/inventory';

/** What an agent of these options answers: only whether it is done. */
export interface DoneAnswer {
	done: boolean;
}

/**
 * The options of an agent on `config` with nothing to read: 8 turns, the review's deadline 30 minutes away, and an
 * answer with a `done` field taken as its result.
 */
export function doneAgentOptions(
	config: ModelConfig,
	overrides: Partial<JsonAgentOptions<DoneAnswer>> = {}
): JsonAgentOptions<DoneAnswer> {
	return {
		label: 'correctness',
		stage: 'reviewer',
		system: '',
		user: '',
		config,
		budget: new ModelBudget(),
		evidence: new EvidenceStore(null, buildInventory(''), 12000),
		maxTurns: 8,
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 30 * 60_000,
		parse: (raw) => (raw && typeof raw === 'object' && 'done' in raw ? { done: raw.done === true } : null),
		...overrides
	};
}
