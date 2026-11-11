import { openLiveProgress } from '../output/live-progress.js';
import { createProgressSink } from '../output/progress-sink.js';
import { writeStderrLine } from '../output/streams.js';
import type { ProgressSink } from '../progress.js';
import type { ReviewOptions, ReviewTarget } from '../review/options.js';
import { tildePath } from '../terminal/home-path.js';
import type { Terminal } from '../terminal/terminal.js';
import type { RunId } from './run-id.js';

/** Progress as the person or program that started a review sees it, and the way to take it down again. */
export interface ShownProgress {
	sink: ProgressSink;
	/** Removes a live view so the report can be printed. Safe to call twice, and does nothing for lines. */
	close: () => void;
}

/**
 * Shows a foreground review's progress on standard error in the format asked for. `live` redraws in place and needs
 * a terminal; anywhere else, such as the log of a background review, it is written as `text` lines. With lines, the
 * run id comes first, so the run can be found again. The live view says so once `stop` aborts: a review takes a
 * moment to clean up, and a person who pressed Ctrl-C must see that it was heard.
 */
export function showProgress(
	run: { options: ReviewOptions; runId: RunId; stop: AbortSignal },
	terminal: Terminal
): ShownProgress {
	const { options, runId } = run;
	const { progress } = options.output;

	if (progress === 'live' && terminal.err.isInteractive) {
		const view = openLiveProgress({
			title: `Reviewing ${describeTarget(options.target)} in ${tildePath(options.repoPath)}`,
			hint: 'ctrl-c cancels',
			startedAt: Date.now(),
			stopping: { signal: run.stop, hint: 'cancelling, ctrl-c again exits now' }
		});

		return { sink: view.sink, close: view.close };
	}

	const format = progress === 'live' ? 'text' : progress;

	if (format === 'text') writeStderrLine(`run: ${runId}`);

	return { sink: createProgressSink(format, writeStderrLine, () => new Date()), close: () => {} };
}

function describeTarget(target: ReviewTarget): string {
	switch (target.kind) {
		case 'range':
			return target.base === null
				? `${target.head} against the default branch`
				: `${target.head} against ${target.base}`;
		case 'staged':
			return 'staged changes';
		case 'uncommitted':
			return 'uncommitted changes';
		case 'pull':
			return `pull request ${target.pull}`;
		case 'diff':
			return target.source === '-' ? 'a diff from standard input' : `the diff ${target.source}`;
	}
}
