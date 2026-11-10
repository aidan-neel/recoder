import { randomBytes } from 'node:crypto';
import { usageError } from '../exit.js';

/**
 * The one shape a run id may have: the UTC start time to the second, then six random hex digits, for example
 * `20261110-153045-a1b2c3`. Ids sort by time, and a run id from the command line becomes a folder name, so nothing
 * else (no `..`, no separator) is ever accepted.
 */
const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

const RANDOM_BYTES = 3;

const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/;

declare const runIdBrand: unique symbol;

/** A string checked against `RUN_ID_PATTERN`, so it is safe to use as a folder name. */
export type RunId = string & { readonly [runIdBrand]: true };

export function isRunId(value: string): value is RunId {
	return RUN_ID_PATTERN.test(value);
}

/** The run id a caller gave; anything that is not one is a usage error naming it. */
export function parseRunId(value: string): RunId {
	if (!isRunId(value)) throw usageError(`"${value}" is not a run id; run ids look like 20261110-153045-a1b2c3.`);

	return value;
}

/** A new run id for a run that starts at `startedAt`. */
export function createRunId(startedAt: Date): RunId {
	const stamp = startedAt.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
	const id = `${stamp}-${randomBytes(RANDOM_BYTES).toString('hex')}`;

	if (!isRunId(id)) throw new Error(`built a malformed run id "${id}"`);

	return id;
}

/** When the run started, read from its id: the id is all a run whose record cannot be read still tells. */
export function runStartedAt(runId: RunId): Date {
	const match = STAMP.exec(runId);

	if (match === null) throw new Error(`run id "${runId}" has no start time`);

	const [, year, month, day, hours, minutes, seconds] = match.map(Number);

	return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}
