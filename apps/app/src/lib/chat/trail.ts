import { isStepRunning, type ChatTrailFile, type ChatTrailStep, type ChatTrailThought } from '@recoder/shared';

/** A step that is a tool call: anything that is not reasoning. */
export type ToolStep = Exclude<ChatTrailStep, ChatTrailThought>;

/** A tool call as one line: what it did, to what, and a short note after it. */
export interface ToolLine {
	verb: string;
	/** What the call touched, drawn in the code face; null when there is nothing to name. */
	target: string | null;
	/** Quiet words after the target, such as the folder a search stayed in. */
	note: string | null;
}

/** How long one step took, in whole seconds, or null while it runs. */
function stepSeconds(step: ChatTrailStep): number | null {
	if (step.endedAt === undefined) return null;

	return Math.max(0, Math.round((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1000));
}

/**
 * How long a finished reply worked before it answered: from the reply's start to the end of its last step, in whole
 * seconds. Null while a step still runs, or when the reply has no start or no step.
 */
export function workedSeconds(startedAt: string | null, steps: readonly ChatTrailStep[]): number | null {
	if (startedAt === null || steps.length === 0 || steps.some(isStepRunning)) return null;

	const end = Math.max(...steps.map((step) => Date.parse(step.endedAt ?? step.startedAt)));

	return Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
}

/** The trail's line once the answer starts: `Worked for 13s`, or `Worked` when the time is unknown or under a second. */
export function workedLabel(seconds: number | null): string {
	return seconds === null || seconds < 1 ? 'Worked' : `Worked for ${spanLabel(seconds)}`;
}

/** A reasoning step's label: the title the provider gave it, else how long the model thought. */
export function thoughtLabel(step: ChatTrailThought): string {
	if (step.title) return step.title;
	if (isStepRunning(step)) return 'Thinking';

	const seconds = stepSeconds(step);

	return seconds === null ? 'Thought' : `Thought for ${spanLabel(seconds)}`;
}

/** The step as a one-line row, worded for the state it is in. */
export function toolLine(step: ToolStep): ToolLine {
	if (step.kind === 'run') {
		const verb = { running: 'Running', done: 'Ran', error: 'Failed' }[step.status];

		return { verb, target: step.command, note: null };
	}

	if (step.kind === 'search') {
		const verb = { running: 'Searching', done: 'Searched', error: 'Search failed' }[step.status];

		return { verb, target: step.query, note: step.scope ? `in ${step.scope}` : null };
	}

	const verb = { running: 'Reading', done: 'Read', error: 'Could not read' }[step.status];

	if (step.files.length === 1) return { verb, target: step.files[0].path, note: null };

	return {
		verb: step.files.length === 0 ? `${verb} files` : `${verb} ${fileCount(step.files.length)}`,
		target: null,
		note: null
	};
}

/** True when a call has more to show than its line: files it touched, or a command to read in full. */
export function hasDetail(step: ToolStep): boolean {
	return step.kind === 'run' || step.files.length > 0;
}

/** Whether a call's detail starts open: the files a search or a read found do; a command's output only once it failed. */
export function opensDetail(step: ToolStep): boolean {
	return step.kind !== 'run' || step.status === 'error';
}

/** `1s`, `12s`, `1m 5s`: a span as a row shows it. */
export function spanLabel(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;

	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The last part of a path: the name a chip shows. */
export function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** A file's lines as a person writes them: `21`, `21-30`, or nothing. */
export function lineRange(file: ChatTrailFile): string {
	if (file.startLine === undefined) return '';

	return file.endLine !== undefined && file.endLine !== file.startLine
		? `${file.startLine}-${file.endLine}`
		: String(file.startLine);
}

/** `1 file`, `3 files`. */
function fileCount(count: number): string {
	return `${count} file${count === 1 ? '' : 's'}`;
}
