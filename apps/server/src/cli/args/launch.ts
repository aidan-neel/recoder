import { usageError } from '../exit.js';
import type { ReviewTarget } from '../review/options.js';
import { parseRunId, type RunId } from '../runs/run-id.js';
import { RUN_ID_FLAG } from './flags.js';

const DETACH_FLAG = '--detach';

/** How a review is started. */
export type ReviewLaunch =
	/** In this process, which prints the report. */
	| { kind: 'foreground' }
	/** In a background process started with these flags, which are the caller's with `--detach` left out. */
	| { kind: 'detach'; flags: string[] }
	/** As the background process of a run that `--detach` created. */
	| { kind: 'background'; runId: RunId };

/** The flags that decide how a review starts. */
interface LaunchFlags {
	detach?: boolean;
	[RUN_ID_FLAG]?: string;
}

/**
 * How the review starts. `parseArgs` takes `--detach` only as a whole argument (a value that starts with a dash must be
 * written `--flag=value`), so dropping the arguments equal to it leaves every other flag as the caller wrote it.
 */
export function resolveLaunch(flags: LaunchFlags, target: ReviewTarget, argv: readonly string[]): ReviewLaunch {
	const runId = flags[RUN_ID_FLAG];

	if (runId !== undefined && flags.detach === true) {
		throw usageError(`--${RUN_ID_FLAG} is for the background process ${DETACH_FLAG} starts; drop it.`);
	}

	if (runId !== undefined) return { kind: 'background', runId: parseRunId(runId) };

	if (flags.detach !== true) return { kind: 'foreground' };

	if (target.kind === 'diff' && target.source === '-') {
		throw usageError(
			`${DETACH_FLAG} cannot read --diff from standard input; save the diff to a file and pass its path.`
		);
	}

	return { kind: 'detach', flags: argv.filter((argument) => argument !== DETACH_FLAG) };
}

/**
 * The argv of the background `recoder review`: the run id first, so a `--` among the caller's flags cannot turn it
 * into a bare argument. The caller's flags never hold the run id flag: `resolveLaunch` rejects it beside `--detach`.
 */
export function backgroundFlags(runId: RunId, flags: readonly string[]): string[] {
	return [`--${RUN_ID_FLAG}`, runId, ...flags];
}
