import type { AssignmentStatus, ReviewAssignment, ReviewStage } from '@recoder/shared';
import { stageLabel } from '../runs/run-view.js';
import { formatDuration } from '../terminal/duration.js';
import { spinnerFrame } from '../terminal/spinner.js';
import type { Surface } from '../terminal/surface.js';
import { indent, padEnd, padStart, plural } from '../terminal/text.js';
import type { ProgressState } from './progress-state.js';

const MARGIN = 2;

const STAGE_INDENT = 4;

const ASSIGNMENT_INDENT = 8;

/** The most reviewers listed under a stage; the rest are counted in one line, so the block keeps its height. */
const MAX_LISTED_ASSIGNMENTS = 6;

const PERCENT = 100;

/** The width of the longest duration a stage shows, `59m 59s`, so the column does not move as time passes. */
const DURATION_WIDTH = 7;

/** The pipeline's stages in the order a review goes through them. */
const STAGE_ORDER: readonly ReviewStage[] = [
	'checkout',
	'understand',
	'checks',
	'reviewing',
	'subagents',
	'verify',
	'consolidation'
];

/** The statuses of an assignment that is not finished. */
const OPEN_STATUSES: readonly AssignmentStatus[] = ['running', 'waiting', 'queued'];

/** What a frame says beyond the review's own progress. */
export interface FrameContext {
	now: number;
	surface: Surface;
	/** What is being reviewed, as the frame's first line. */
	title: string;
	/** How to leave, as the last words of the frame. */
	hint: string;
}

/** One frame of the live view: the title, a line per stage with who is working under the current one, and the totals. */
export function progressFrame(state: ProgressState, context: FrameContext): string[] {
	const { surface, now } = context;
	const spinner = surface.paint.info(spinnerFrame(surface, now));

	return [
		'',
		...indent([`${spinner} ${surface.paint.strong(context.title)}`], MARGIN),
		'',
		...indent(stageLines(state, context), STAGE_INDENT),
		'',
		...indent([surface.paint.muted(totals(state, context).join(` ${surface.glyphs.separator} `))], STAGE_INDENT),
		''
	];
}

/** The stages entered so far and those still ahead; a stage the review skipped is left out. */
function stageLines(state: ProgressState, context: FrameContext): string[] {
	const current = state.stage === null ? -1 : STAGE_ORDER.indexOf(state.stage);
	const shown = STAGE_ORDER.filter((stage, index) => state.stageStartedAt[stage] !== undefined || index > current);
	const width = Math.max(...shown.map((stage) => stageLabel(stage).length));

	return shown.flatMap((stage) => stageBlock(stage, state, { ...context, width }));
}

function stageBlock(stage: ReviewStage, state: ProgressState, context: FrameContext & { width: number }): string[] {
	const { surface, now, width } = context;
	const { paint, glyphs } = surface;
	const label = padEnd(stageLabel(stage), width);
	const startedAt = state.stageStartedAt[stage];

	if (startedAt === undefined) return [paint.muted(`${glyphs.pending} ${label}`)];

	if (stage !== state.stage) {
		const took = formatDuration(stageEnd(stage, state) - startedAt);

		return [`${paint.ok(glyphs.ok)} ${label}  ${paint.muted(padStart(took, DURATION_WIDTH))}`];
	}

	const running = formatDuration(now - startedAt);
	const line = `${paint.info(spinnerFrame(surface, now))} ${paint.strong(label)}  ${padStart(running, DURATION_WIDTH)}`;

	return [line, ...indent(assignmentLines(state.assignments, context), ASSIGNMENT_INDENT - STAGE_INDENT)];
}

/** A finished stage ended when the next one entered after it began. */
function stageEnd(stage: ReviewStage, state: ProgressState): number {
	const startedAt = state.stageStartedAt[stage] ?? state.startedAt;
	const later = Object.values(state.stageStartedAt).filter((at) => at > startedAt);

	return later.length > 0 ? Math.min(...later) : startedAt;
}

/** Who is working now, in the order they appeared, and one line counting those that finished. */
function assignmentLines(assignments: readonly ReviewAssignment[], context: FrameContext): string[] {
	const { surface } = context;
	const open = assignments.filter((assignment) => OPEN_STATUSES.includes(assignment.status));
	const finished = assignments.length - open.length;
	const listed = open.slice(0, MAX_LISTED_ASSIGNMENTS).map((assignment) => assignmentLine(assignment, context));
	const unlisted = open.length - listed.length;

	return [
		...listed,
		...(unlisted > 0 ? [surface.paint.muted(`${surface.glyphs.pending} ${unlisted} more waiting`)] : []),
		...(finished > 0 ? [surface.paint.muted(`${surface.glyphs.ok} ${finished} finished`)] : [])
	];
}

function assignmentLine(assignment: ReviewAssignment, { surface, now }: FrameContext): string {
	const { paint, glyphs } = surface;
	const isRunning = assignment.status === 'running';
	const mark = isRunning ? paint.info(spinnerFrame(surface, now)) : paint.muted(glyphs.pending);
	const doing = isRunning ? operationOf(assignment) : assignment.status;
	const found = assignment.candidateCount ? plural(assignment.candidateCount, 'possible issue') : null;
	const detail = [doing, found].filter(Boolean).join(` ${glyphs.separator} `);

	return detail === '' ? `${mark} ${assignment.title}` : `${mark} ${assignment.title} ${paint.muted(detail)}`;
}

/** What the assignment is doing, without its own title, which the pipeline ends many operations with. */
function operationOf(assignment: ReviewAssignment): string | undefined {
	return assignment.currentOperation?.replace(` for ${assignment.title}`, '').trim();
}

/** The review's totals: possible issues, budget used, time so far, and how to leave. */
function totals(state: ProgressState, context: FrameContext): string[] {
	const { budget, candidates } = state;
	const used = budget && budget.limit > 0 ? Math.round((budget.used / budget.limit) * PERCENT) : null;

	return [
		...(candidates ? [plural(candidates, 'possible issue')] : []),
		...(used === null ? [] : [`${used}% of the budget used`]),
		formatDuration(context.now - state.startedAt),
		context.hint
	];
}
