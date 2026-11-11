import { relative } from 'node:path';
import { commandRows } from '../terminal/layout.js';
import { tildePath } from '../terminal/home-path.js';
import { textWidth, type Surface } from '../terminal/surface.js';
import { indent, padEnd, wrapText } from '../terminal/text.js';
import type { InitScope } from './init-request.js';
import type { InitStep, StepState } from './init-step.js';

const MARGIN = 2;

const STEP_INDENT = 4;

const COLUMN_GAP = 2;

/** The widest step label, so the steps line up though they are printed one at a time. */
const LABEL_WIDTH = 'Review model'.length;

/** What `recoder init` did, as a program reads it. */
export interface InitResult {
	scope: InitScope;
	/** Whether every step ended with Recoder set up and this machine able to review. */
	ready: boolean;
	steps: InitStep[];
}

/** Where the steps' paths are shown from: the project folder for a project, the home folder for the machine. */
export interface PathDisplay {
	scope: InitScope;
	projectFolder: string;
}

/** The first line of `recoder init`, before its steps. */
export function initHeading(scope: InitScope, { paint }: Surface): string[] {
	const where = scope === 'project' ? 'this project' : 'this machine';

	return ['', `${' '.repeat(MARGIN)}${paint.strong(`Setting up Recoder for ${where}`)}`, ''];
}

/** One step as it is printed when it ends: its mark, what it is, what happened and where, and what to do about it. */
export function stepLines(step: InitStep, display: PathDisplay, surface: Surface): string[] {
	const { paint, glyphs } = surface;
	const detailIndent = glyphs.ok.length + 1 + LABEL_WIDTH + COLUMN_GAP;
	const room = textWidth(surface, STEP_INDENT + detailIndent);
	const where = step.path === null ? '' : ` ${glyphs.separator} ${shownPath(step.path, display)}`;
	const [first = '', ...rest] = wrapText(`${step.detail}${where}`, room);
	const fix = step.fix === null ? [] : wrapText(`${glyphs.arrow} ${step.fix}`, room).map(paint.muted);
	const head = `${markOf(step.state, surface)} ${padEnd(step.label, LABEL_WIDTH)}${' '.repeat(COLUMN_GAP)}${first}`;

	return indent([head, ...indent([...rest, ...fix], detailIndent)], STEP_INDENT);
}

/** What comes after the steps: the commands to try, or that something is left to fix. */
export function initClosing(result: InitResult, surface: Surface): string[] {
	const { paint } = surface;

	if (!result.ready) {
		return [
			'',
			...indent([paint.strong('Not finished.'), 'Fix what is marked above, then run recoder init again.'], MARGIN),
			''
		];
	}

	const commands = commandRows(
		[
			['recoder review --uncommitted', 'Review your work in progress'],
			['recoder review', 'Review this branch against the default branch'],
			['recoder review --pull <number>', 'Review a pull request']
		],
		surface
	);

	const hasNewRules = result.steps.some((step) => step.id === 'guidelines' && step.state === 'done');

	const rules = hasNewRules
		? ['Write the rules reviewers should follow in RECODER.md, and commit it with the skill.']
		: [];

	return [
		'',
		...indent(
			[paint.strong('Ready.'), ...rules, 'Ask your agent to review a change with recoder, or run a review yourself:'],
			MARGIN
		),
		'',
		...indent(commands, STEP_INDENT),
		''
	];
}

function markOf(state: StepState, { paint, glyphs }: Surface): string {
	const marks: Record<StepState, string> = {
		done: paint.ok(glyphs.ok),
		unchanged: paint.ok(glyphs.ok),
		skipped: paint.warning(glyphs.warn),
		failed: paint.error(glyphs.fail)
	};

	return marks[state];
}

/** A path inside the project is shown from the project's folder; any other from the home folder. */
function shownPath(path: string, display: PathDisplay): string {
	const fromProject = relative(display.projectFolder, path);

	return display.scope === 'project' && !fromProject.startsWith('..') ? fromProject : tildePath(path);
}
