import { usageError } from '../exit.js';
import { isRunId, type RunId } from './run-id.js';
import { listRunIds } from './run-list.js';

/** The fewest characters of a run id that may stand for it. */
const MIN_PART_LENGTH = 3;

/** How many matching run ids an ambiguous part names in its error. */
const NAMED_MATCHES = 5;

/**
 * The characters a run id is made of. A part is matched against the ids on disk and never used in a path, and
 * anything else, such as a `..` or a separator, is refused before the disk is read.
 */
const RUN_ID_PART = /^[0-9a-f-]+$/;

/** The last six characters of a run id, which is how a person names a run. */
const SHORT_ID_LENGTH = 6;

/**
 * How a caller names a run: its whole id, a part of it such as the six characters `recoder runs` shows, or nothing,
 * which means the newest run.
 */
export type RunReference = { kind: 'id'; runId: RunId } | { kind: 'part'; text: string } | { kind: 'newest' };

/** Reads the run a command was given; text that could not be part of a run id is a usage error naming it. */
export function parseRunReference(value: string | undefined): RunReference {
	if (value === undefined) return { kind: 'newest' };

	if (isRunId(value)) return { kind: 'id', runId: value };

	if (value.length < MIN_PART_LENGTH || !RUN_ID_PART.test(value)) {
		throw usageError(
			`"${value}" is not a run id; run ids look like 20261110-153045-a1b2c3, and the last six characters are enough.`
		);
	}

	return { kind: 'part', text: value };
}

/** The run a reference names. No run, or more than one, is a usage error that says what to run next. */
export async function resolveRunReference(reference: RunReference): Promise<RunId> {
	if (reference.kind === 'id') return reference.runId;

	const runIds = await listRunIds();

	return reference.kind === 'newest' ? newestOf(runIds) : matchOf(runIds, reference.text);
}

/** The six characters a person can type in place of the whole id. */
export function shortRunId(runId: RunId): string {
	return runId.slice(-SHORT_ID_LENGTH);
}

function newestOf(runIds: readonly RunId[]): RunId {
	const [newest] = runIds;

	if (newest === undefined) throw usageError('there are no runs yet; start one with recoder review.');

	return newest;
}

/** A part names the run whose id ends with it, else the one whose id holds it anywhere. */
function matchOf(runIds: readonly RunId[], text: string): RunId {
	const ending = runIds.filter((runId) => runId.endsWith(text));
	const matches = ending.length > 0 ? ending : runIds.filter((runId) => runId.includes(text));

	if (matches.length === 1) return matches[0];

	if (matches.length === 0) throw usageError(`no run matches "${text}"; run recoder runs to list them.`);

	const named = matches.slice(0, NAMED_MATCHES).join(', ');
	const more = matches.length > NAMED_MATCHES ? ` and ${matches.length - NAMED_MATCHES} more` : '';

	throw usageError(`"${text}" matches ${matches.length} runs: ${named}${more}. Give more of the id.`);
}
