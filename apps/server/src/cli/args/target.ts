import { usageError } from '../exit.js';
import type { CommitStart, PullStart, ReviewTarget } from '../review/options.js';
import { NON_RANGE_TARGETS } from './flags.js';
import { rejectMoreThanOne } from './lists.js';
import { parseText, requireText } from './values.js';

const DEFAULT_HEAD = 'HEAD';

/** The flags that choose what to review. */
export type TargetFlags = {
	base?: string;
	head?: string;
	staged?: boolean;
	uncommitted?: boolean;
	pull?: string;
	since?: string;
	full?: boolean;
	diff?: string;
};

/** What to review: the one of `--staged`, `--uncommitted`, `--pull` and `--diff` that is given, else a commit range. */
export function selectTarget(flags: TargetFlags): ReviewTarget {
	rejectMoreThanOne(flags, NON_RANGE_TARGETS);
	rejectRangeWithOtherTarget(flags);
	rejectSinceWithoutPull(flags);
	rejectFullWithSince(flags);

	if (flags.staged !== undefined) return { kind: 'staged' };

	if (flags.uncommitted !== undefined) return { kind: 'uncommitted' };

	if (flags.pull !== undefined) {
		return { kind: 'pull', pull: requireText('--pull', flags.pull), start: pullStart(flags) };
	}

	if (flags.diff !== undefined) return { kind: 'diff', source: requireText('--diff', flags.diff) };

	return {
		kind: 'range',
		base: parseText('--base', flags.base),
		head: parseText('--head', flags.head) ?? DEFAULT_HEAD,
		start: commitStart(flags)
	};
}

/** Where a commit range's review begins: the whole change, or after the last review that counts. */
function commitStart(flags: TargetFlags): CommitStart {
	return flags.full === true ? { kind: 'whole' } : { kind: 'continue' };
}

/** Where a pull request's review begins: the commit the caller named, the whole change, or after the last review. */
function pullStart(flags: TargetFlags): PullStart {
	if (flags.since !== undefined) return { kind: 'named', commit: requireText('--since', flags.since) };

	return commitStart(flags);
}

/** `--base` and `--head` describe a commit range, so they mean nothing next to another target. */
function rejectRangeWithOtherTarget(flags: TargetFlags): void {
	const named = NON_RANGE_TARGETS.find((name) => flags[name] !== undefined);

	if (named === undefined || (flags.base === undefined && flags.head === undefined)) return;

	throw usageError(`--base and --head choose a commit range and cannot be used with --${named}.`);
}

/** `--since` starts a pull request's diff at one of its commits, so it means nothing without `--pull`. */
function rejectSinceWithoutPull(flags: TargetFlags): void {
	if (flags.since !== undefined && flags.pull === undefined) throw usageError('--since needs --pull.');
}

/** `--full` reviews everything and `--since` starts at a commit; together they contradict each other. */
function rejectFullWithSince(flags: TargetFlags): void {
	if (flags.full === true && flags.since !== undefined) {
		throw usageError('--full and --since cannot be used together.');
	}
}
