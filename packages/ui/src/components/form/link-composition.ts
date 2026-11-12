import { plainText } from './link-edits';
import type { Snapshot } from './link-history';
import { embedLinks, fitInsert, linkAfter, linkBefore, replaceRange, wordAround, type LinkDoc } from './link-model';

/**
 * What the editor remembers while the browser owns an edit (an IME composition,
 * or an input type the editor lets through): the state before the DOM changed,
 * and any external `value` that arrived while composing.
 */
export interface Composition {
	readonly active: boolean;
	readonly before: Snapshot | null;
	readonly pending: string | null;
}

/** What happens when an IME composition finishes: apply a deferred external value, or adopt the DOM edit. */
type CompositionOutcome = { kind: 'pending'; text: string } | { kind: 'adopt'; before: Snapshot | null };

/** Inputs to reconcile a browser-written DOM state back into the model. */
interface AdoptInput {
	before: LinkDoc;
	read: LinkDoc;
	caret: number;
	maxLength: number | undefined;
}

/** How the inserted slice changed under `maxLength`, so the caret moves with it. */
interface InsertedSpan {
	prefix: number;
	readEnd: number;
	rawLength: number;
	keptLength: number;
	totalLength: number;
}

export const EMPTY_COMPOSITION: Composition = { active: false, before: null, pending: null };

/** Marks a composition active and keeps the snapshot from before the browser touched the DOM. */
export function startComposition(state: Composition, snapshot: Snapshot): Composition {
	return { active: true, before: state.active ? (state.before ?? snapshot) : snapshot, pending: state.pending };
}

/** Saves the pre-edit snapshot for an un-cancelled `beforeinput` that `input` will adopt. */
export function holdBeforeInput(state: Composition, snapshot: Snapshot): Composition {
	if (state.active) return state;

	return { active: false, before: snapshot, pending: null };
}

/** Stores an external value when composing so `compositionend` can apply it; null when not composing. */
export function deferValue(state: Composition, text: string): Composition | null {
	return state.active ? { ...state, pending: text } : null;
}

/** Ends a composition and reports whether an external value superseded it or the DOM edit should be adopted. */
export function endComposition(state: Composition): { state: Composition; outcome: CompositionOutcome } {
	if (state.pending !== null) {
		return { state: EMPTY_COMPOSITION, outcome: { kind: 'pending', text: state.pending } };
	}

	return { state: EMPTY_COMPOSITION, outcome: { kind: 'adopt', before: state.before } };
}

/** Consumes any saved `beforeinput` snapshot when `input` adopts a browser edit outside composition. */
export function takeBeforeInput(state: Composition): { state: Composition; before: Snapshot | null } {
	return { state: EMPTY_COMPOSITION, before: state.before };
}

/**
 * Reconciles a DOM state the browser wrote (`read`) with the model before it
 * (`before`), clamping what the edit added to `maxLength` and keeping untouched
 * embeds whole.
 */
export function adoptEdit({ before, read, caret, maxLength }: AdoptInput): { doc: LinkDoc; caret: number } {
	const prefix = commonPrefix(before, read);
	const { beforeEnd, readEnd } = commonSuffix(before, read, prefix);
	const beforeRange = { start: prefix, end: beforeEnd };
	const rawInserted = read.text.slice(prefix, readEnd);
	const inserted = fitInsert(before, beforeRange, plainText(rawInserted), maxLength);
	const replaced = replaceRange(before, beforeRange, inserted);

	const nextCaret = adoptedCaret(caret, {
		prefix,
		readEnd,
		rawLength: rawInserted.length,
		keptLength: inserted.length,
		totalLength: replaced.text.length
	});

	return {
		doc: embedLinks(replaced, wordAround(replaced.text, nextCaret)),
		caret: nextCaret
	};
}

/** How far from the start `before` and `read` match, treating each embed as one indivisible unit. */
function commonPrefix(before: LinkDoc, read: LinkDoc): number {
	let offset = 0;

	while (offset < before.text.length && offset < read.text.length) {
		const embedEnd = sameEmbedAfter(before, read, offset);

		if (embedEnd !== null) {
			offset = embedEnd;

			continue;
		}

		if (linkAfter(before, offset) || linkAfter(read, offset)) break;
		if (before.text[offset] !== read.text[offset]) break;

		offset += 1;
	}

	return wholeCodePointStart(before, offset);
}

/** How far from the end `before` and `read` match without crossing `prefix`, keeping embeds whole. */
function commonSuffix(before: LinkDoc, read: LinkDoc, prefix: number): { beforeEnd: number; readEnd: number } {
	let beforeEnd = before.text.length;
	let readEnd = read.text.length;

	while (beforeEnd > prefix && readEnd > prefix) {
		const starts = sameEmbedBefore(before, read, { beforeEnd, readEnd, prefix });

		if (starts) {
			beforeEnd = starts.beforeStart;
			readEnd = starts.readStart;

			continue;
		}

		if (linkBefore(before, beforeEnd) || linkBefore(read, readEnd)) break;
		if (before.text[beforeEnd - 1] !== read.text[readEnd - 1]) break;

		beforeEnd -= 1;
		readEnd -= 1;
	}

	if (beforeEnd < before.text.length && !linkAfter(before, beforeEnd) && isLowSurrogate(before.text, beforeEnd)) {
		beforeEnd += 1;
		readEnd += 1;
	}

	return { beforeEnd, readEnd };
}

/** The end offset when both docs start the same embed at `offset`, else null. */
function sameEmbedAfter(before: LinkDoc, read: LinkDoc, offset: number): number | null {
	const beforeLink = linkAfter(before, offset);
	const readLink = linkAfter(read, offset);

	if (!beforeLink || !readLink) return null;

	const same = before.text.slice(beforeLink.start, beforeLink.end) === read.text.slice(readLink.start, readLink.end);

	return same ? beforeLink.end : null;
}

/** The start offsets when both docs end the same embed at `beforeEnd` / `readEnd` at or after `prefix`, else null. */
function sameEmbedBefore(
	before: LinkDoc,
	read: LinkDoc,
	bounds: { beforeEnd: number; readEnd: number; prefix: number }
): { beforeStart: number; readStart: number } | null {
	const beforeLink = linkBefore(before, bounds.beforeEnd);
	const readLink = linkBefore(read, bounds.readEnd);

	if (!beforeLink || !readLink) return null;
	if (beforeLink.start < bounds.prefix || readLink.start < bounds.prefix) return null;

	const same = before.text.slice(beforeLink.start, beforeLink.end) === read.text.slice(readLink.start, readLink.end);

	return same ? { beforeStart: beforeLink.start, readStart: readLink.start } : null;
}

/** Steps back one UTF-16 unit when `offset` stopped between the halves of a surrogate pair. */
function wholeCodePointStart(doc: LinkDoc, offset: number): number {
	if (offset > 0 && !linkBefore(doc, offset) && isHighSurrogate(doc.text, offset - 1)) return offset - 1;

	return offset;
}

/** True when the UTF-16 code unit at `index` is a high surrogate. */
function isHighSurrogate(text: string, index: number): boolean {
	const code = text.charCodeAt(index);

	return code >= 0xd800 && code <= 0xdbff;
}

/** True when the UTF-16 code unit at `index` is a low surrogate. */
function isLowSurrogate(text: string, index: number): boolean {
	const code = text.charCodeAt(index);

	return code >= 0xdc00 && code <= 0xdfff;
}

/** Adjusts the DOM caret when `fitInsert` trimmed part of the inserted slice. */
function adoptedCaret(caret: number, span: InsertedSpan): number {
	const trimmed = span.rawLength - span.keptLength;
	const shifted = caret >= span.readEnd ? caret - trimmed : Math.min(caret, span.prefix + span.keptLength);

	return Math.min(span.totalLength, Math.max(0, shifted));
}
