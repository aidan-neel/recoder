import type { RepoChatMessage } from '@recoder/shared';
import { MAX_REPLY_CHARS } from './chat-record';
import type { TrailRecorder } from './chat-trail';

/** Two pieces of text as paragraphs: one blank line between them, or either alone when the other is empty. */
function joinParagraphs(before: string, after: string): string {
	if (!before.trim()) return after;
	if (!after.trim()) return before;

	return `${before.trimEnd()}\n\n${after.trimStart()}`;
}

/**
 * Adds streamed text to what came before it. A model writes its text as separate parts with no space between them,
 * so a new part starts a new paragraph.
 */
export function appendPart(text: string, delta: string, startsPart: boolean): string {
	return startsPart ? joinParagraphs(text, delta) : text + delta;
}

/** Longer text than this, since the last tool call, reads as the answer rather than a line about what comes next. */
const NARRATION_CHARS = 240;

/** A heading, a list or a code block: the shape of an answer, never of a line about the next step. */
const ANSWER_SHAPE = /^\s*(?:#{1,6}\s|[-*]\s|\d+\.\s|```)/m;

/**
 * A reply's text as an agent run writes it. What the model writes before it calls a tool says what it is about to do
 * ("I'll read the README"); it is not the answer. While such words are short they stream into one note in the trail,
 * not into the reply, and the tool call ends the note. Words that grow into an answer move into the reply, and when
 * the run ends, the words after the last tool call are the answer, however short.
 */
export class ReplyText {
	private answer: string;
	private said = '';
	private part: string | null = null;
	/** The note `said` streams into while it reads as a line about the next step. */
	private noteId: string | null = null;

	constructor(
		private readonly reply: RepoChatMessage,
		private readonly trail: TrailRecorder
	) {
		this.answer = reply.text;
	}

	/** Streams the model's text; `part` names the part it streams in. */
	write(delta: string, part: string): void {
		const startsPart = this.part !== null && part !== this.part;

		this.part = part;
		this.said = appendPart(this.said, delta, startsPart);
		this.place();
	}

	/** Adds words a tool gave the reply, such as the review it started. They stay in the answer. */
	add(text: string): void {
		if (this.reply.text.includes(text)) return;

		this.answer = joinParagraphs(this.answer, text);
		this.show();
	}

	/** A tool was called: what the model said before it is a finished note in the trail. */
	toolCalled(): void {
		const note = this.said.trim();
		const id = this.noteId ?? crypto.randomUUID();

		this.said = '';
		this.part = null;
		this.noteId = null;

		if (!note) return;

		this.trail.writeNote(id, note);
		this.trail.endNote(id);
		this.show();
	}

	/** The run ended: the words after the last tool call are the answer, so a note holding them leaves the trail. */
	finish(): void {
		if (this.noteId === null) return;

		this.trail.dropNote(this.noteId);
		this.noteId = null;
		this.show();
	}

	/** Puts `said` in its note while it reads as a line about the next step, else in the reply. */
	private place(): void {
		const text = this.said.trim();

		if (text && isNarration(text)) {
			this.noteId ??= crypto.randomUUID();
			this.trail.writeNote(this.noteId, text);
		} else if (this.noteId !== null) {
			this.trail.dropNote(this.noteId);
			this.noteId = null;
		}

		this.show();
	}

	private show(): void {
		const streaming = this.noteId === null ? this.said : '';

		this.reply.text = joinParagraphs(this.answer, streaming).slice(0, MAX_REPLY_CHARS);
	}
}

/** Short words with no answer's shape. Words only grow, so once they read as an answer they stay one. */
function isNarration(text: string): boolean {
	return text.length <= NARRATION_CHARS && !ANSWER_SHAPE.test(text);
}
