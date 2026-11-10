import type { ProgressSink } from '../progress.js';
import type { ProgressFormat } from '../review/options.js';

/**
 * Where progress goes. `none` drops every event, `text` writes a line when the stage or the candidate count
 * changes, and `ndjson` writes every event as a JSON object stamped with the time it arrived.
 */
export function createProgressSink(
	format: ProgressFormat,
	writeLine: (line: string) => void,
	now: () => Date
): ProgressSink {
	if (format === 'none') return () => {};

	if (format === 'ndjson') return (event) => writeLine(JSON.stringify({ at: now().toISOString(), ...event }));

	return createTextSink(writeLine);
}

/** One line per stage change and per new candidate count; logs, assignments and budgets stay out of the way. */
function createTextSink(writeLine: (line: string) => void): ProgressSink {
	let stage: string | null = null;
	let candidates: number | null = null;

	return (event) => {
		if (event.type === 'stage' && event.stage !== stage) {
			stage = event.stage;
			writeLine(`stage: ${event.stage}`);
		}

		if (event.type === 'candidates' && event.count !== candidates) {
			candidates = event.count;
			writeLine(`candidate findings: ${event.count}`);
		}
	};
}

/** One sink that passes each event to every sink given, in order. */
export function teeProgress(sinks: readonly ProgressSink[]): ProgressSink {
	return (event) => {
		for (const sink of sinks) sink(event);
	};
}
