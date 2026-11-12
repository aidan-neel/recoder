import type { ModelFailure } from '@recoder/shared';
import { UsageLimitError, type LlmError } from '../models/llm/errors';
import { outOfUsage } from '../models/out-of-usage';

/**
 * How an agent that signs in to one account words a failed call. Its usage cap names the agent and quotes its own
 * message, which carries the reset time; any other failure is its message, which is written for people.
 */
export function cliFailure(agent: { id: string; name: string }, err: LlmError, fallback: string): ModelFailure {
	if (err instanceof UsageLimitError) {
		return outOfUsage({ provider: agent.id, name: agent.name, usageUrl: null }, err.message);
	}

	return { reason: err.message || fallback };
}
