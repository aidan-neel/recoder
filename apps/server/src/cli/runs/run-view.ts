import type { ReviewTarget } from '../review/options.js';
import { formatAgo, formatDuration } from '../terminal/duration.js';
import { tildePath } from '../terminal/home-path.js';
import { commandRows, factRows, type NextStep } from '../terminal/layout.js';
import { textWidth, type Surface } from '../terminal/surface.js';
import { renderTable } from '../terminal/table.js';
import { indent, plural, wrapText } from '../terminal/text.js';
import type { CancelStatus } from './cancel-run.js';
import type { DetachedRun } from './detach.js';
import { shortRunId } from './run-reference.js';
import type { RunState } from './run-record.js';
import type { RunStatus } from './run-status.js';

const MARGIN = 2;

const FACT_INDENT = 4;

/** What a run reviews, in a few words. */
const TARGET_LABELS: Record<ReviewTarget['kind'], string> = {
	range: 'branch',
	staged: 'staged changes',
	uncommitted: 'uncommitted changes',
	pull: 'pull request',
	diff: 'diff file'
};

/** Each stage as the app's timeline names it. */
const STAGE_LABELS: Record<string, string> = {
	checkout: 'Checkout',
	understand: 'Understand',
	checks: 'Checks',
	reviewing: 'Review',
	subagents: 'Subagents',
	verify: 'Verify',
	consolidation: 'Finish'
};

/** What a run reviews, in a few words. */
export function targetLabel(kind: ReviewTarget['kind']): string {
	return TARGET_LABELS[kind];
}

/** The name of a pipeline stage as a person reads it; a stage this version does not know keeps its own name. */
export function stageLabel(stage: string): string {
	return STAGE_LABELS[stage] ?? stage;
}

/** `recoder status`: the run's state and counts, where it lives, and the command that comes next. */
export function statusView(now: Date): (status: RunStatus, surface: Surface) => string[] {
	return (status, surface) => ['', ...statusLines(status, surface, now), ''];
}

/** `recoder cancel`: whether a stop was sent, then the run as `recoder status` shows it. */
export function cancelView(now: Date): (status: CancelStatus, surface: Surface) => string[] {
	return (status, surface) => {
		const note = status.stopRequested
			? 'Asked the review to stop. It cleans up and ends in a moment.'
			: `Nothing to stop: the run is ${status.state}.`;

		return ['', ...indent([note], MARGIN), '', ...statusLines(status, surface, now), ''];
	};
}

/** `recoder review --detach`: that the review is running in the background, and how to follow it. */
export function detachedView(run: DetachedRun, surface: Surface): string[] {
	const { status, outcome } = run;
	const { paint, glyphs } = surface;

	if (outcome !== 'started') return ['', ...statusLines(status, surface, new Date(status.startedAt)), ''];

	const short = shortRunId(status.runId);

	return [
		'',
		...indent([`${paint.ok(glyphs.ok)} ${paint.strong('Review started in the background')}`], MARGIN),
		'',
		...indent(factRows([['run', status.runId]], surface), FACT_INDENT),
		'',
		...indent(
			commandRows(
				[
					[`recoder wait ${short}`, 'watch it until it ends'],
					[`recoder result ${short}`, 'read the report once it has'],
					[`recoder cancel ${short}`, 'stop it']
				],
				surface
			),
			FACT_INDENT
		),
		''
	];
}

/** `recoder runs`: one row per run, newest first. */
export function runsView(now: Date): (statuses: RunStatus[], surface: Surface) => string[] {
	return (statuses, surface) => {
		if (statuses.length === 0) {
			return ['', ...indent(['No reviews yet. Start one with recoder review.'], MARGIN), ''];
		}

		const table = renderTable(
			[
				{ heading: 'RUN' },
				{ heading: 'STATE' },
				{ heading: 'FINDINGS', alignRight: true },
				{ heading: 'TARGET' },
				{ heading: 'STARTED' },
				{ heading: 'REPOSITORY' }
			],
			statuses.map((status) => runRow(status, surface, now)),
			surface
		);

		return ['', ...indent(table, MARGIN), ''];
	};
}

function runRow(status: RunStatus, surface: Surface, now: Date): string[] {
	return [
		surface.paint.strong(shortRunId(status.runId)),
		stateMark(status, surface),
		status.findings === null ? surface.paint.muted('-') : String(status.findings),
		targetLabel(status.targetKind),
		formatAgo(new Date(status.startedAt), now),
		tildePath(status.repoPath)
	];
}

function statusLines(status: RunStatus, surface: Surface, now: Date): string[] {
	const headline = [stateMark(status, surface), ...headlineFacts(status, now)].join(` ${surface.glyphs.separator} `);
	const error = status.error === null ? [] : wrapText(status.error, textWidth(surface, FACT_INDENT));
	const steps = stepsAfter(status);

	return [
		...indent([surface.paint.strong(headline)], MARGIN),
		...indent(error.map(surface.paint.muted), FACT_INDENT),
		'',
		...indent(factRows(runFacts(status, now), surface), FACT_INDENT),
		...(steps.length > 0 ? ['', ...indent(commandRows(steps, surface), FACT_INDENT)] : [])
	];
}

/** The state as a colored mark and a word, so it reads without color too. */
function stateMark(status: RunStatus, surface: Surface): string {
	const { paint, glyphs } = surface;

	const marks: Record<RunState, string> = {
		running: paint.info(`${glyphs.dot} running`),
		complete: paint.ok(`${glyphs.ok} complete`),
		failed: paint.error(`${glyphs.fail} failed`),
		cancelled: paint.warning(`${glyphs.warn} cancelled`)
	};

	return marks[status.state];
}

/** What follows the state on the first line: the stage of a running review, or the counts and time of a finished one. */
function headlineFacts(status: RunStatus, now: Date): string[] {
	const started = new Date(status.startedAt).getTime();

	if (status.state === 'running') {
		const stage = status.stage === null ? [] : [stageLabel(status.stage)];

		return [...stage, formatDuration(now.getTime() - started)];
	}

	const findings = status.findings === null ? [] : [plural(status.findings, 'finding')];
	const unconfirmed = status.unconfirmed ? [`${status.unconfirmed} unconfirmed`] : [];
	const took = status.finishedAt === null ? [] : [formatDuration(new Date(status.finishedAt).getTime() - started)];

	return [...findings, ...unconfirmed, ...took];
}

function runFacts(status: RunStatus, now: Date): [string, string][] {
	const rows: [string, string | null][] = [
		['run', status.runId],
		['repository', tildePath(status.repoPath)],
		['target', targetLabel(status.targetKind)],
		['started', formatAgo(new Date(status.startedAt), now)],
		['log', status.logFile === null ? null : tildePath(status.logFile)]
	];

	return rows.filter((row): row is [string, string] => row[1] !== null);
}

/** The commands that make sense for a run in this state. */
function stepsAfter(status: RunStatus): NextStep[] {
	const short = shortRunId(status.runId);

	if (status.state === 'running') {
		return [
			[`recoder wait ${short}`, 'watch it until it ends'],
			[`recoder cancel ${short}`, 'stop it']
		];
	}

	return status.reportFile === null ? [] : [[`recoder result ${short}`, 'read the report']];
}
