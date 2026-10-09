import { REVIEW_POLICY } from '../../session/review-policy.js';
import { canLaunchInvestigation } from '../agent-loop.js';
import type { CandidateFinding } from '../consolidate.js';
import { isQualityLens } from '../lenses/lenses.js';
import { unitRecord, type ReviewUnit } from '../units.js';
import {
	extendDeadlines,
	finishedIds,
	poolContext,
	publishBudget,
	publishUnits,
	saveCheckpoint,
	type ReviewRun
} from '../harness/context.js';
import { runUnitPool } from '../harness/pool.js';
import { huntOn, huntRounds } from './config.js';

/** A first-pass lens assignment, `unit-2/security`; retries, subagents and earlier hunts don't match. */
const LENS_ASSIGNMENT = /^unit-\d+\/[a-z-]+$/;

/** Two reports on one file this many lines apart or closer count as the same place when a round is judged dry. */
const NEAR_LINES = 3;

/** Earlier reports one hunter is shown; past this the list stops, so the prompt stays bounded. */
const MAX_LISTED = 40;

/**
 * Runs the defect lenses over every unit again, each told what the review has
 * reported on its files so far, and repeats until a round adds no valid
 * candidate at a new place or `huntRounds` rounds have run. Hunters report
 * into the same verify queue as the first pass. Only with `RECODER_HUNT=1`.
 * A resume finds a round's units by their id and runs the unfinished ones.
 */
export async function runHuntRounds(run: ReviewRun): Promise<void> {
	if (!huntOn()) return;

	for (let round = 1; round <= huntRounds(); round++) {
		if (!canLaunchInvestigation(run.investigationDeadline, run.budget)) return;

		const units = roundUnits(run, round);

		if (!units.length) return;

		const finished = finishedIds(run);
		const pending = units.filter((unit) => !finished.has(unit.id));

		run.events?.onStage?.('reviewing');
		await runUnitPool(pending, run.assignments, { ...poolContext(run), subagentCap: 0 });

		const fresh = freshCandidates(run.candidates, round);

		run.events?.onLog?.(
			`Hunt round ${round} found ${fresh.length} new valid candidate${fresh.length === 1 ? '' : 's'}.`
		);

		if (!fresh.length) return;
	}
}

/** The round's hunters: those a resumed review already planned, else new ones, with budget and time to match. */
function roundUnits(run: ReviewRun, round: number): ReviewUnit[] {
	const planned = run.units.filter((unit) => unit.id.endsWith(huntSuffix(round)));

	if (planned.length) return planned;

	const units = huntUnits(run.units, run.candidates, round);

	run.budget.limit += units.length * REVIEW_POLICY.callsPerAssignment;
	extendDeadlines(run, units.length * REVIEW_POLICY.msPerAssignment);

	for (const unit of units) {
		const record = unitRecord(unit);

		run.units.push(unit);
		run.assignments.push(record);
		run.events?.onAssignment?.(record);
	}

	publishUnits(run, 4);
	publishBudget(run);
	saveCheckpoint(run);

	return units;
}

function huntSuffix(round: number): string {
	return `/hunt-${round}`;
}

/** One hunter per first-pass defect-lens assignment, keeping its lens and scope, briefed with what is already reported. */
export function huntUnits(units: ReviewUnit[], candidates: CandidateFinding[], round: number): ReviewUnit[] {
	return units
		.filter((unit) => LENS_ASSIGNMENT.test(unit.id) && unit.lens && !isQualityLens(unit.lens))
		.map((unit) => ({
			...unit,
			id: `${unit.id}${huntSuffix(round)}`,
			title: `${unit.title} · hunt ${round}`,
			reason: huntReason(unit, candidates)
		}));
}

/** The hunter's brief: look past every report already made on its files, valid or not, so none is raised twice. */
function huntReason(unit: ReviewUnit, candidates: CandidateFinding[]): string {
	const paths = new Set(unit.scope.map((entry) => entry.path));
	const seen = candidates.filter((candidate) => paths.has(candidate.file));

	const listed = seen
		.slice(0, MAX_LISTED)
		.map(
			(candidate) =>
				`- ${candidate.file}:${candidate.line ?? 'file'} ${candidate.title ?? candidate.message.split('\n')[0]}`
		);

	const more = seen.length > MAX_LISTED ? [`- and ${seen.length - MAX_LISTED} more`] : [];

	return [
		'A second look at this unit. Earlier reviewers already reported the issues below, and each is being checked on its own, so do not report them again.',
		'Find the defects they missed: other changed lines, other inputs and branches, and how the changed symbols meet their callers and tests. An empty findings list is the right answer when nothing else is wrong.',
		`Already reported:\n${listed.length ? [...listed, ...more].join('\n') : '- nothing yet'}`
	].join('\n\n');
}

/** Valid candidates the round's hunters raised at a place no earlier report names. */
export function freshCandidates(candidates: CandidateFinding[], round: number): CandidateFinding[] {
	const suffix = huntSuffix(round);
	const fromRound = (candidate: CandidateFinding) => candidate.assignmentId?.endsWith(suffix) ?? false;
	const earlier = candidates.filter((candidate) => !fromRound(candidate));

	return candidates.filter(
		(candidate) => candidate.valid && fromRound(candidate) && !earlier.some((other) => samePlace(other, candidate))
	);
}

/** Same file, and lines within `NEAR_LINES` of each other; a file-level report matches anything on its file. */
function samePlace(a: CandidateFinding, b: CandidateFinding): boolean {
	if (a.file !== b.file) return false;
	if (a.line === undefined || b.line === undefined) return true;

	return Math.abs(a.line - b.line) <= NEAR_LINES;
}
