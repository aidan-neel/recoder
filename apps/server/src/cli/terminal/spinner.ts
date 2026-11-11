import { guardedStderr } from '../output/streams.js';
import { LiveRegion } from './live-region.js';
import type { Surface } from './surface.js';
import type { Terminal } from './terminal.js';

/** How often a spinner moves on a frame: quick enough to read as motion, slow enough not to flicker. */
export const SPINNER_INTERVAL_MS = 80;

/** The spinner frame to show at `now`, so every spinner on screen turns together. */
export function spinnerFrame(surface: Surface, now: number): string {
	const frames = surface.glyphs.spinner;

	return frames[Math.floor(now / SPINNER_INTERVAL_MS) % frames.length];
}

/**
 * Runs `work` with a spinner and `label` beside it on standard error, and removes both when the work ends, whatever
 * it returns or throws. Only a person at a terminal sees it: for a program, or with standard error redirected, it
 * only runs the work.
 */
export async function withSpinner<Result>(
	label: string,
	terminal: Terminal,
	work: () => Promise<Result>
): Promise<Result> {
	const surface = terminal.err;

	if (terminal.audience !== 'person' || !surface.isInteractive) return work();

	const region = new LiveRegion(guardedStderr(), surface.glyphs.ellipsis);
	const draw = (): void => region.render([`  ${surface.paint.info(spinnerFrame(surface, Date.now()))} ${label}`]);
	const timer = setInterval(draw, SPINNER_INTERVAL_MS);

	draw();

	try {
		return await work();
	} finally {
		clearInterval(timer);
		region.close();
	}
}
