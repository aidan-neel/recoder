import type { ReviewAssignment, ReviewProgress, ReviewTask } from '@recoder/shared';

import { plural } from '../shell/format';
import type { RunLine, RunMark } from './types';

/** Where a claim under check stands, read from its verification task. */
export type RunClaimState =
	| 'waiting'
	| 'reproducing'
	| 'tracing'
	| 'checking'
	| 'reproduced'
	| 'traced'
	| 'confirmed'
	| 'duplicate'
	| 'not-run'
	| 'unproven'
	| 'unsettled'
	| 'cleared'
	| 'checked'
	| 'stopped';

const CLAIM_STATES: Record<RunClaimState, { word: string; mark: RunMark }> = {
	waiting: { word: 'Waiting', mark: 'waiting' },
	reproducing: { word: 'Reproducing', mark: 'working' },
	tracing: { word: 'Tracing', mark: 'working' },
	checking: { word: 'Checking', mark: 'working' },
	reproduced: { word: 'Reproduced', mark: 'found' },
	traced: { word: 'Traced', mark: 'found' },
	confirmed: { word: 'Confirmed', mark: 'found' },
	duplicate: { word: 'Same as another', mark: 'settled' },
	'not-run': { word: 'Could not run', mark: 'unsure' },
	unproven: { word: 'Not proven', mark: 'settled' },
	unsettled: { word: 'Not settled', mark: 'unsure' },
	cleared: { word: 'Cleared', mark: 'settled' },
	checked: { word: 'Checked', mark: 'settled' },
	stopped: { word: 'Stopped', mark: 'stopped' }
};

/**
 * A running verifier's message, as the pipeline words it
 * (`review/pipeline/harness/verification.ts`): a verifier that runs code
 * reproduces, one that reads traces. Its turns in between say `Thinking`.
 */
const AT_WORK: [RegExp, RunClaimState][] = [
	[/^(Reproducing|Running code)/, 'reproducing'],
	[/^(Tracing|Reading code)/, 'tracing']
];

/** A settled verifier's last word, as the pipeline words it. Anything else it says reads as `Checked`. */
const SETTLED: [RegExp, RunClaimState][] = [
	[/^Verified by a run/, 'reproduced'],
	[/^Traced through the code/, 'traced'],
	[/^Checked against the (rule|repo)/, 'confirmed'],
	[/^Verified with /, 'duplicate'],
	[/^Not run/, 'not-run'],
	[/^Could not prove/, 'unproven'],
	[/dropped$|^Examples not found/, 'cleared']
];

function matching(rules: [RegExp, RunClaimState][], message: string, fallback: RunClaimState): RunClaimState {
	return rules.find(([pattern]) => pattern.test(message))?.[1] ?? fallback;
}

/** Where a claim stands, from its verification task's status and message. */
export function claimState(task: Pick<ReviewTask, 'status' | 'message'>): RunClaimState {
	switch (task.status) {
		case 'queued':
		case 'waiting':
			return 'waiting';
		case 'running':
			return matching(AT_WORK, task.message, 'checking');
		case 'done':
			return matching(SETTLED, task.message, 'checked');
		case 'error':
			return 'stopped';
		default:
			return 'unsettled';
	}
}

/** The claim a verification task checks: its label without the pipeline's `Verify: `. */
function claimTitle(task: ReviewTask): string {
	return task.label.replace(/^Verify:\s*/, '');
}

/** How many claims a step lists before it sums up the rest. */
const LISTED = 4;

/** The order lines are listed in: what was found, then what is at work, then the rest. */
const LIST_ORDER: Record<RunMark, number> = { found: 0, working: 1, stopped: 2, unsure: 2, settled: 3, waiting: 4 };

/** How the summary line names the claims left out, by their mark. */
const REST_WORDS: Record<RunMark, string> = {
	found: 'more found',
	working: 'more at work',
	stopped: 'more stopped',
	unsure: 'more not settled',
	settled: 'more cleared',
	waiting: 'waiting'
};

/** The newest settled line first; lines still at work keep their order so they do not jump. */
function newestSettledFirst(a: RunLine & { at: string }, b: RunLine & { at: string }): number {
	const order = LIST_ORDER[a.mark] - LIST_ORDER[b.mark];

	if (order !== 0 || a.mark !== 'settled') return order;

	return b.at.localeCompare(a.at);
}

/** `9 more cleared · 17 waiting`: the claims the list leaves out, by where they stand. */
function restOf(lines: RunLine[]): string | null {
	const counts = new Map<RunMark, number>();

	for (const line of lines) counts.set(line.mark, (counts.get(line.mark) ?? 0) + 1);

	const parts = [...counts].map(([mark, count]) => `${count} ${REST_WORDS[mark]}`);

	return parts.length ? parts.join(' · ') : null;
}

/** The verification tasks of a review, one a claim. */
export function verificationTasks(progress: ReviewProgress): ReviewTask[] {
	return Object.values(progress.tasks).filter((task) => task.kind === 'verification');
}

/**
 * The claims under check as lines: every claim found, then those at work,
 * then the newest settled, up to four lines; a waiting claim is only counted.
 * `found` counts the claims a verifier proved, a copy of another's proof aside.
 */
export function claimLines(progress: ReviewProgress): { lines: RunLine[]; rest: string | null; found: number } {
	const all = verificationTasks(progress)
		.map((task) => ({ id: task.id, title: claimTitle(task), at: task.updatedAt, ...CLAIM_STATES[claimState(task)] }))
		.sort(newestSettledFirst);

	const shown = all.filter((line) => line.mark !== 'waiting').slice(0, LISTED);
	const lines = shown.map(({ id, title, mark, word }) => ({ id, title, mark, word }));

	return {
		lines,
		rest: restOf(all.slice(shown.length)),
		found: all.filter((line) => line.mark === 'found').length
	};
}

/** Where a part of the plan stands: waiting, read by its reviewer, done with the claims it raised, or stopped. */
function partLine(part: ReviewAssignment): RunLine {
	const line = { id: part.id, title: part.title };

	switch (part.status) {
		case 'running':
			return { ...line, mark: 'working', word: 'Reviewing' };
		case 'done':
			return { ...line, mark: 'settled', word: part.candidateCount ? plural(part.candidateCount, 'claim') : 'Done' };
		case 'error':
			return { ...line, mark: 'stopped', word: 'Stopped' };
		case 'skipped':
			return { ...line, mark: 'unsure', word: 'Skipped' };
		default:
			return { ...line, mark: 'waiting', word: 'Waiting' };
	}
}

/** The parts of the plan, one a reviewer, as lines. */
export function partLines(progress: ReviewProgress): RunLine[] {
	return (progress.assignments ?? []).map(partLine);
}
