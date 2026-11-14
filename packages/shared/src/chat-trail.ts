/** What a repository chat reply did before and while it answered, as the page draws it: its trail. */

/** A reply keeps at most this many steps; the oldest are dropped past it. */
export const MAX_TRAIL_STEPS = 40;

/** One thought's text is cut past this. */
export const MAX_THOUGHT_CHARS = 4000;

/** A step names at most this many files. */
export const MAX_STEP_FILES = 12;

/** A reply keeps at most this many cited passages. */
export const MAX_CITATIONS = 8;

/** A cited passage's text is cut past this. */
export const MAX_SNIPPET_CHARS = 400;

/** A file a step read or found, and the lines it names when it names any. */
export interface ChatTrailFile {
	path: string;
	startLine?: number;
	endLine?: number;
}

interface TrailStepBase {
	id: string;
	startedAt: string;
	/** Set when the step stops, so a finished step keeps its length instead of timing to now. */
	endedAt?: string;
}

/** The model's reasoning, as far as its provider discloses it. */
export interface ChatTrailThought extends TrailStepBase {
	kind: 'thought';
	/** A short heading for the thought; empty when the provider gave none. */
	title: string;
	text: string;
}

/** Looking for text in the repository's files. */
export interface ChatTrailSearch extends TrailStepBase {
	kind: 'search';
	query: string;
	/** A folder or file the search stayed in. */
	scope?: string;
	status: 'running' | 'done' | 'error';
	/** The files with a match. */
	files: ChatTrailFile[];
}

/** Opening files to read them. */
export interface ChatTrailRead extends TrailStepBase {
	kind: 'read';
	status: 'running' | 'done' | 'error';
	files: ChatTrailFile[];
}

/** A command run in the repository. */
export interface ChatTrailRun extends TrailStepBase {
	kind: 'run';
	command: string;
	status: 'running' | 'done' | 'error';
	/** A short outcome, such as `12 passed`. */
	summary?: string;
}

export type ChatTrailStep = ChatTrailThought | ChatTrailSearch | ChatTrailRead | ChatTrailRun;

/** A passage of the repository a reply cites, with its text as it was when the reply was written. */
export interface ChatCitation {
	path: string;
	startLine?: number;
	endLine?: number;
	snippet: string;
}

/** The trail with `step` added, or put in place of the step with its id, keeping the newest `MAX_TRAIL_STEPS`. */
export function withTrailStep(trail: readonly ChatTrailStep[], step: ChatTrailStep): ChatTrailStep[] {
	const index = trail.findIndex((existing) => existing.id === step.id);

	if (index >= 0) return trail.map((existing, at) => (at === index ? step : existing));

	return [...trail, step].slice(-MAX_TRAIL_STEPS);
}

/** True while the step is still going. */
export function isStepRunning(step: ChatTrailStep): boolean {
	return step.kind === 'thought' ? step.endedAt === undefined : step.status === 'running';
}

/** What a reply's links to the repository start with: `[name](#cite:src/a.ts:12-20)`. */
export const CITATION_PREFIX = '#cite:';

const CITATION_REF = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/;

/** A file and its lines, as written in a citation link. */
export function citationRef(file: ChatTrailFile): string {
	if (file.startLine === undefined) return file.path;

	const range = file.endLine !== undefined && file.endLine !== file.startLine ? `-${file.endLine}` : '';

	return `${file.path}:${file.startLine}${range}`;
}

/** The file and lines a citation reference names, or null when it is not one. */
export function parseCitationRef(ref: string): ChatTrailFile | null {
	const match = CITATION_REF.exec(ref.trim());

	if (!match || match[1].includes(' ')) return null;

	const startLine = match[2] === undefined ? undefined : Number(match[2]);
	const endLine = match[3] === undefined ? undefined : Number(match[3]);

	if (startLine === 0 || (startLine !== undefined && endLine !== undefined && endLine < startLine)) return null;

	return {
		path: match[1],
		...(startLine === undefined ? {} : { startLine }),
		...(endLine === undefined ? {} : { endLine })
	};
}

/** The files a citation link's target names: `#cite:a.ts:1-4,b.ts` is two. Empty when the target is not a citation. */
export function parseCitationTarget(href: string): ChatTrailFile[] {
	if (!href.startsWith(CITATION_PREFIX)) return [];

	return href
		.slice(CITATION_PREFIX.length)
		.split(',')
		.map(parseCitationRef)
		.filter((file): file is ChatTrailFile => file !== null);
}

const CITATION_LINK = /\]\((#cite:[^)\s]+)\)/g;

/** The distinct files a reply's citation links name, in order, at most `MAX_CITATIONS`. */
export function citedFiles(text: string): ChatTrailFile[] {
	const found = new Map<string, ChatTrailFile>();

	for (const match of text.matchAll(CITATION_LINK)) {
		for (const file of parseCitationTarget(match[1])) found.set(citationRef(file), file);
	}

	return [...found.values()].slice(0, MAX_CITATIONS);
}
