import type { ProgressEvent, ProgressSink } from '../progress.js';
import { LiveRegion } from '../terminal/live-region.js';
import { SPINNER_INTERVAL_MS } from '../terminal/spinner.js';
import { surfaceOf } from '../terminal/surface.js';
import { progressFrame } from './progress-frame.js';
import { advanceProgress, initialProgress } from './progress-state.js';
import { guardedStderr } from './streams.js';

/** What the live view says around the review's own progress. */
interface LiveProgressOptions {
	title: string;
	hint: string;
	/** When the review started, so a view opened on a review already running shows its real age. */
	startedAt: number;
	/** The signal that stops the review, and what the view says in place of the hint once it has aborted. */
	stopping?: { signal: AbortSignal; hint: string };
}

/** A live view of one review on standard error. */
export interface LiveProgress {
	/** Takes an event as it happens. */
	sink: ProgressSink;
	/** Takes an event that happened at `at`, for a view that reads a run's recorded progress. */
	advance: (event: ProgressEvent, at: number) => void;
	/** Removes the view and gives the terminal back. Safe to call twice. */
	close: () => void;
}

/**
 * Opens the live view: a block on standard error that redraws as the review moves on and as time passes. The caller
 * closes it before anything else is printed.
 */
export function openLiveProgress(options: LiveProgressOptions): LiveProgress {
	const stream = guardedStderr();
	const region = new LiveRegion(stream, surfaceOf(stream, process.env).glyphs.ellipsis);
	let state = initialProgress(options.startedAt);

	const draw = (): void => {
		const surface = surfaceOf(stream, process.env);

		const hint = options.stopping?.signal.aborted ? options.stopping.hint : options.hint;

		region.render(progressFrame(state, { now: Date.now(), surface, title: options.title, hint }));
	};

	const timer = setInterval(draw, SPINNER_INTERVAL_MS);

	const advance = (event: ProgressEvent, at: number): void => {
		state = advanceProgress(state, event, at);
	};

	draw();

	return {
		sink: (event) => advance(event, Date.now()),
		advance,
		close: () => {
			clearInterval(timer);
			region.close();
		}
	};
}
