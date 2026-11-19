import { AsyncLocalStorage } from 'node:async_hooks';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { ReviewAbortedError, throwIfAborted } from './budget.js';

/** One review run's agent slots: how many agents run, and who waits for one, in arrival order. */
interface AgentSlots {
	active: number;
	waiting: (() => void)[];
}

const reviews = new AsyncLocalStorage<AgentSlots>();

/** Agents `run` starts, however nested, share one review's slots; see {@link withAgentSlot}. */
export function withReviewAgentSlots<T>(run: () => T): T {
	return reviews.run({ active: 0, waiting: [] }, run);
}

/**
 * Runs `run` once its review has fewer than `REVIEW_POLICY.maxConcurrentAgents` agents running, so a huge pull
 * request goes out in waves instead of starting every reviewer, verifier and brief call at once. The wait happens
 * before the agent starts, so its own clock and turns are untouched; the review's deadline keeps running, as it does
 * for any queued work.
 *
 * Agents outside a review run (chat, fixes) are not capped. Workers are not capped either: one only runs inside a
 * reviewer that already holds a slot, so making it wait could leave every slot held by a reviewer waiting on its own
 * worker.
 */
export async function withAgentSlot<T>(stage: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
	const slots = reviews.getStore();

	if (!slots || stage === 'worker') return run();

	await acquire(slots, signal);

	try {
		return await run();
	} finally {
		release(slots);
	}
}

/** Takes a slot at once when one is free, else waits for one; an abort while waiting leaves the line and throws. */
async function acquire(slots: AgentSlots, signal: AbortSignal): Promise<void> {
	throwIfAborted(signal);

	if (slots.active < REVIEW_POLICY.maxConcurrentAgents && !slots.waiting.length) {
		slots.active++;

		return;
	}

	await new Promise<void>((resolve, reject) => {
		const grant = () => {
			signal.removeEventListener('abort', abort);
			resolve();
		};

		const abort = () => {
			slots.waiting.splice(slots.waiting.indexOf(grant), 1);
			reject(new ReviewAbortedError('review aborted'));
		};

		slots.waiting.push(grant);
		signal.addEventListener('abort', abort, { once: true });
	});

	if (signal.aborted) {
		release(slots);
		throwIfAborted(signal);
	}
}

/** Hands a freed slot straight to the next agent in line, so a newcomer cannot take it first. */
function release(slots: AgentSlots): void {
	const next = slots.waiting.shift();

	if (next) next();
	else slots.active--;
}
