import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a model request waits for a slot on behalf of, usually one review. When
 * an endpoint is full the limiter takes turns between lanes, so one busy review
 * cannot hold back another.
 *
 * Lanes live apart from the limiter because the metrics a model call records
 * open one, and the limiter reads the agent registry: a call's metrics must
 * load without the registry, which loads every agent adapter.
 */
export interface LlmLane {
	id: string;
	/** Told how long each request in the lane waited for its slot, 0 when one was free. Runs while the slot is held, so it must not throw. */
	recordWait: (waitedMs: number) => void;
}

/** The lane of requests made outside any review: home brief, settings checks. */
const SHARED_LANE: LlmLane = { id: '', recordWait: () => undefined };

const lanes = new AsyncLocalStorage<LlmLane>();

/** Model requests `run` makes, however nested, wait for slots in `lane`'s turn. */
export function withLlmLane<T>(lane: LlmLane, run: () => T): T {
	return lanes.run(lane, run);
}

/** The lane the running code makes its model requests in; the shared lane outside any review. */
export function currentLlmLane(): LlmLane {
	return lanes.getStore() ?? SHARED_LANE;
}
