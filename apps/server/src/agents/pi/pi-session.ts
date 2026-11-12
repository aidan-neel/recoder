import { z } from 'zod';
import type { AgentEvent } from '../contract';
import { quotedLine } from '../quoted-line';
import { tokenUsage, type PiUsage } from './pi-output';

/** How often a running call's session file is read for the model calls Pi finished since. */
const POLL_MS = 500;

/** Longest stretch of an unreadable line quoted in an error event. */
const QUOTED_CHARS = 120;

const NEWLINE = 0x0a;

/** A line of the session file (`docs/session-format.md`): an entry of a type, with an id, maybe holding a message. */
const entrySchema = z.object({
	type: z.string(),
	id: z.string().optional(),
	message: z.object({ role: z.string() }).loose().optional()
});

/** An assistant message, as far as Recoder reads it: one model call's text, thinking, usage and how it ended. */
const assistantSchema = z.object({
	role: z.literal('assistant'),
	content: z.array(z.object({ type: z.string(), text: z.string().optional(), thinking: z.string().optional() })),
	usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }),
	stopReason: z.string(),
	errorMessage: z.string().optional()
});

/** One model call Pi saved: its answer text and how it ended. */
export interface PiReply {
	text: string;
	stopReason: string;
	errorMessage?: string;
}

/** What one call wrote to the session: its last model call, and the usage of each. */
export interface PiTurn {
	reply: PiReply | null;
	usages: PiUsage[];
}

/**
 * Follows the session file Pi appends each entry to as it ends, and reports each model call it saved as a step:
 * its thinking and text, then its usage. Pi's `--mode json` would stream the same calls, but it repeats the whole
 * message on every delta, so its output grows with the square of a reply's length; this file grows with the
 * reply. Entries are read once, by id, across the calls of one run.
 */
export class SessionTail {
	private offset = 0;
	private readonly seen = new Set<string>();
	/** The reads in order; it never rejects, so one failed read does not fail the reads after it. */
	private reading: Promise<void> = Promise.resolve();
	/** The first read that failed since {@link follow}, raised once by {@link finish}. */
	private readFailure: unknown = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private turn: PiTurn = { reply: null, usages: [] };

	constructor(
		private readonly file: string,
		private readonly onEvent: (event: AgentEvent) => void
	) {}

	/** Starts following the file for one call. */
	follow(): void {
		this.turn = { reply: null, usages: [] };
		this.readFailure = null;
		this.timer = setInterval(() => this.poll(), POLL_MS);
	}

	/**
	 * Stops following, reads what the call left, and returns what it wrote. Throws when a read of the file failed
	 * during the call, since a model call may then be missing from the steps.
	 */
	async finish(): Promise<PiTurn> {
		if (this.timer) clearInterval(this.timer);

		this.timer = null;
		await this.read();

		const failure = this.readFailure;

		this.readFailure = null;

		if (failure) throw new Error("Recoder could not read Pi's session file.", { cause: failure });

		return this.turn;
	}

	/**
	 * One tick while Pi runs: a sign of life, then a read. Pi saves an entry only when a message ends and, in text
	 * mode, prints only the final answer, so a long model call is otherwise silent and the engine would stop it as
	 * stalled. A Pi that hangs is still stopped, by the prompt's deadline.
	 */
	private poll(): void {
		this.onEvent({ type: 'activity' });
		void this.read();
	}

	/** Queues a read after the ones before it; a failed read is held for {@link finish}. */
	private read(): Promise<void> {
		this.reading = this.reading
			.then(() => this.readNew())
			.catch((error: unknown) => {
				this.readFailure ??= error;
			});

		return this.reading;
	}

	/** Reads the whole lines appended since the last read; the file starts over when it shrank. */
	private async readNew(): Promise<void> {
		const file = Bun.file(this.file);

		if (!(await file.exists())) return;
		if (file.size < this.offset) this.offset = 0;

		const bytes = await file.slice(this.offset).bytes();
		const end = bytes.lastIndexOf(NEWLINE);

		if (end < 0) return;

		this.offset += end + 1;

		for (const line of new TextDecoder().decode(bytes.subarray(0, end)).split('\n')) {
			if (line.trim()) this.line(line);
		}
	}

	private line(line: string): void {
		let value: unknown;

		try {
			value = JSON.parse(line);
		} catch {
			return this.unreadable(line);
		}

		const entry = entrySchema.safeParse(value);

		if (!entry.success) return this.unreadable(line);

		const { id, message } = entry.data;

		if (id && this.seen.has(id)) return;
		if (id) this.seen.add(id);

		if (entry.data.type !== 'message' || message?.role !== 'assistant') return this.onEvent({ type: 'activity' });

		const assistant = assistantSchema.safeParse(message);

		if (!assistant.success) return this.unreadable(line);

		this.step(id ?? `pi_${this.seen.size}`, assistant.data);
	}

	/** One model call: a step with its thinking and text, ended by its usage. A failed call is also logged. */
	private step(id: string, message: z.infer<typeof assistantSchema>): void {
		this.onEvent({ type: 'step-start', step: id });

		message.content.forEach((part, index) => {
			const partId = `${id}_${index}`;

			if (part.type === 'thinking' && part.thinking) this.onEvent({ type: 'reasoning', delta: part.thinking, partId });
			if (part.type === 'text' && part.text) this.onEvent({ type: 'text', delta: part.text, partId });
		});

		this.onEvent({ type: 'usage', usage: tokenUsage(message.usage), step: id });

		if (message.errorMessage) {
			this.onEvent({ type: 'error', message: `Pi: ${quotedLine(message.errorMessage, QUOTED_CHARS)}` });
		}

		const text = message.content.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n');

		this.turn.reply = { text, stopReason: message.stopReason, errorMessage: message.errorMessage };
		this.turn.usages.push(message.usage);
	}

	private unreadable(line: string): void {
		this.onEvent({
			type: 'error',
			message: `Pi wrote a session line Recoder could not read: "${quotedLine(line, QUOTED_CHARS)}"`
		});
	}
}
