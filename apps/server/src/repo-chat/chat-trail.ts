import {
	citedFiles,
	MAX_SNIPPET_CHARS,
	MAX_STEP_FILES,
	MAX_THOUGHT_CHARS,
	withTrailStep,
	type ChatCitation,
	type ChatTrailFile,
	type ChatTrailStep,
	type Repo,
	type RepoChatMessage
} from '@recoder/shared';
import { readRepoText } from './repo-context';
import { appendPart } from './reply-text';

/** A heading a model puts on its own line to title a thought: `**Framing the question**`. */
const THOUGHT_HEADING = /^\*\*([^*\n]{1,80})\*\*[ \t]*$/;

/** A cited passage shows at most this many lines. */
const MAX_SNIPPET_LINES = 8;

/** One thought as a model wrote it: its heading, if it had one, and its text. */
export interface ParsedThought {
	title: string;
	text: string;
}

/**
 * The thoughts in reasoning text. A line that is only a bold phrase starts a
 * new thought and titles it; text before the first such line is one thought
 * with no title. Reasoning with no headings is one thought.
 */
export function parseThoughts(reasoning: string): ParsedThought[] {
	const thoughts: ParsedThought[] = [];
	let current: { title: string; lines: string[] } = { title: '', lines: [] };

	const close = () => {
		const text = current.lines.join('\n').trim();

		if (text || current.title) thoughts.push({ title: current.title, text });
	};

	for (const line of reasoning.split('\n')) {
		const heading = THOUGHT_HEADING.exec(line.trim());

		if (heading) {
			close();
			current = { title: heading[1].trim(), lines: [] };
		} else {
			current.lines.push(line);
		}
	}

	close();

	return thoughts;
}

/** What a tool call showed of itself, from its arguments. */
export interface ToolStepDetail {
	path?: string;
	query?: string;
	scope?: string;
	files?: string[];
	command?: string;
	startLine?: number;
	endLine?: number;
}

/**
 * Writes what a reply reports about its work into the reply's trail: the
 * files it read, the tools it called, and the reasoning its model discloses.
 * It adds nothing a source did not report. Each change calls `changed` so the reply can save.
 */
export class TrailRecorder {
	private reasoning = '';
	private reasoningPart: string | null = null;
	private readId: string | null = null;

	constructor(
		private readonly reply: RepoChatMessage,
		private readonly changed: () => void
	) {}

	/** Marks that the files are being read. */
	startReading(): void {
		this.readId = crypto.randomUUID();

		this.put({ id: this.readId, kind: 'read', status: 'running', files: [], startedAt: now() });
	}

	/** Closes the reading with the files it read; with none, the step is dropped. */
	finishReading(paths: string[]): void {
		const open = this.reply.trail?.find((step) => step.id === this.readId);

		if (!open || open.kind !== 'read') return;

		if (paths.length === 0) {
			this.reply.trail = this.reply.trail?.filter((step) => step.id !== open.id);
			this.changed();

			return;
		}

		this.put({
			...open,
			status: 'done',
			files: paths.slice(0, MAX_STEP_FILES).map((path) => ({ path })),
			endedAt: now()
		});
	}

	/** Adds reasoning text the model disclosed; the thought it belongs to grows. `part` names the part it streams in. */
	addReasoning(delta: string, part = ''): void {
		const startsPart = this.reasoningPart !== null && part !== this.reasoningPart;

		this.reasoningPart = part;
		this.reasoning = appendPart(this.reasoning, delta, startsPart).slice(0, MAX_THOUGHT_CHARS * 4);

		const thoughts = parseThoughts(this.reasoning);

		thoughts.forEach((thought, index) => {
			const id = `thought-${index}`;
			const known = this.reply.trail?.find((step) => step.id === id);

			this.put({
				id,
				kind: 'thought',
				title: thought.title,
				text: thought.text.slice(0, MAX_THOUGHT_CHARS),
				startedAt: known?.startedAt ?? now(),
				...(known?.endedAt || index < thoughts.length - 1 ? { endedAt: known?.endedAt ?? now() } : {})
			});
		});
	}

	/** Shows what the model says it will do next as a note, which grows in place while the words stream. */
	writeNote(id: string, text: string): void {
		const known = this.reply.trail?.find((step) => step.id === id);

		this.put({ id, kind: 'note', text: text.slice(0, MAX_THOUGHT_CHARS), startedAt: known?.startedAt ?? now() });
	}

	/** Ends a note: the model called the tool it spoke of. */
	endNote(id: string): void {
		const open = this.reply.trail?.find((step) => step.id === id);

		if (open?.kind === 'note') this.put({ ...open, endedAt: now() });
	}

	/** Takes a note back out of the trail: its words turned out to be the answer. */
	dropNote(id: string): void {
		this.reply.trail = (this.reply.trail ?? []).filter((step) => step.id !== id);
		this.changed();
	}

	/** Ends the thought still going, when the model moves on to its answer or the reply ends. */
	endThinking(): void {
		const last = this.reply.trail?.filter((step) => step.kind === 'thought' && step.endedAt === undefined).at(-1);

		if (last) this.put({ ...last, endedAt: now() });
	}

	/**
	 * Opens a trail step for one tool call and returns its id. Calls a model makes side by side each get their own
	 * step, so one finishing never closes another.
	 */
	startToolStep(name: string, detail: ToolStepDetail): string {
		const id = crypto.randomUUID();

		this.put(this.renderedToolStep(id, name, detail, 'running', now()));

		return id;
	}

	/** Closes one call's step with how the call went. */
	finishToolStep(id: string, isError: boolean): void {
		const open = this.reply.trail?.find((step) => step.id === id);

		if (!open || open.kind === 'thought' || open.kind === 'note') return;

		this.put({ ...open, status: isError ? 'error' : 'done', endedAt: now() });
	}

	private renderedToolStep(
		id: string,
		name: string,
		detail: ToolStepDetail,
		status: 'running' | 'done' | 'error',
		startedAt: string
	): ChatTrailStep {
		if (name === 'search') {
			return {
				id,
				kind: 'search',
				query: detail.query ?? '',
				...(detail.scope ? { scope: detail.scope } : {}),
				status,
				files: stepFiles(detail),
				startedAt
			};
		}

		if (name === 'read_file' || name === 'list_files') {
			return { id, kind: 'read', status, files: stepFiles(detail), startedAt };
		}

		return { id, kind: 'run', command: detail.command ?? name, status, startedAt };
	}

	private put(step: ChatTrailStep): void {
		this.reply.trail = withTrailStep(this.reply.trail ?? [], step);
		this.changed();
	}
}

/**
 * The passages the reply's citation links name, read from the repository.
 * A link to a file this server cannot read, or to lines the file does not
 * have, gets no passage, and the page shows it as plain text.
 */
export async function citationsFor(repo: Repo, text: string, signal: AbortSignal): Promise<ChatCitation[]> {
	const found = await Promise.all(citedFiles(text).map((file) => citation(repo, file, signal)));

	return found.filter((item): item is ChatCitation => item !== null);
}

async function citation(repo: Repo, file: ChatTrailFile, signal: AbortSignal): Promise<ChatCitation | null> {
	const content = await readRepoText(repo, file.path, signal);

	if (content === null) return null;

	const lines = content.split('\n');
	const first = file.startLine ?? 1;
	const last = Math.min(file.endLine ?? first, first + MAX_SNIPPET_LINES - 1, lines.length);

	if (first > lines.length) return null;

	const snippet = lines
		.slice(first - 1, last)
		.join('\n')
		.slice(0, MAX_SNIPPET_CHARS);

	return { ...file, snippet };
}

function stepFiles(detail: ToolStepDetail): ChatTrailFile[] {
	const paths = detail.files ?? (detail.path ? [detail.path] : []);

	return paths.slice(0, MAX_STEP_FILES).map((path, index) => ({
		path,
		...(index === 0 && detail.startLine !== undefined ? { startLine: detail.startLine } : {}),
		...(index === 0 && detail.endLine !== undefined ? { endLine: detail.endLine } : {})
	}));
}

function now(): string {
	return new Date().toISOString();
}
