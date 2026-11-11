import type { RunId } from '../runs/run-id.js';

/** A start in its handover: the stop that ends it, and the promise that settles once it has ended. */
interface PendingStart {
	handover: AbortController;
	ended: Promise<void>;
}

/**
 * The reviews this server is starting, until their background process takes the run over. Until then a run's record
 * names this server's own process, so a cancel must stop the start here instead of signalling that process.
 */
export class PendingStarts {
	private readonly starts = new Map<RunId, PendingStart>();

	/** Records a start in its handover and returns the function that marks it ended. */
	add(runId: RunId, handover: AbortController): () => void {
		const ended = Promise.withResolvers<void>();

		this.starts.set(runId, { handover, ended: ended.promise });

		return () => {
			this.starts.delete(runId);
			ended.resolve();
		};
	}

	/** Stops the start of `runId` and waits until it has ended; false when no start of that run is pending. */
	async cancel(runId: RunId): Promise<boolean> {
		const start = this.starts.get(runId);

		if (start === undefined) return false;

		start.handover.abort();
		await start.ended;

		return true;
	}
}
