import { failure, type RetrievalAction, type ToolResult } from '../../../evidence/types.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import type { JsonAgentOptions } from './options.js';

/** Added to the request shapes of an agent that can hand tasks to a worker. */
export const DELEGATE_SHAPE =
	'\nYou may also hand one narrow, self-contained task to a worker: {"action":"delegate","task":"Find every caller of `acquire` in src/ and say whether each releases the permit on error. Return file:line for each."}';

/** Hands a `delegate` action to the agent's worker, or refuses it when the agent has none. */
export function runDelegation<T>(opts: JsonAgentOptions<T>, action: RetrievalAction): Promise<ToolResult> {
	if (!opts.delegate) return Promise.resolve(failure('delegate', 'You have no worker to hand tasks to.'));

	return opts.delegate(action);
}

/**
 * Runs one turn's actions: the evidence actions as one round through the
 * store, and each delegation through the agent's worker at the same time.
 * Results come back in the order the actions were asked.
 */
export async function executeTurn<T>(
	opts: JsonAgentOptions<T>,
	actions: RetrievalAction[],
	agentId: string
): Promise<ToolResult[]> {
	const asked = actions.slice(0, REVIEW_POLICY.maxRetrievalsPerTurn);
	const reads = asked.filter((action) => action.action !== 'delegate');

	const [readResults, delegated] = await Promise.all([
		reads.length
			? opts.evidence.executeRound(reads, opts.signal, opts.onTool, REVIEW_POLICY.maxRetrievalsPerTurn, agentId)
			: Promise.resolve([]),
		Promise.all(asked.filter((action) => action.action === 'delegate').map((action) => runDelegation(opts, action)))
	]);

	return asked.map((action) => (action.action === 'delegate' ? delegated : readResults).shift() as ToolResult);
}

/** Commands an agent ran this turn, its own and those its workers ran for it. */
export function commandsRun(actions: RetrievalAction[], results: ToolResult[]): number {
	return (
		actions.filter((action) => action.action === 'run').length +
		results.reduce((sum, result) => sum + (result.runs ?? 0), 0)
	);
}
