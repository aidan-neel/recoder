import { findingsStore } from '$lib/findings/findings.svelte';
import { fixFindings } from '$lib/findings/fixes';
import { notesStore } from '$lib/findings/notes.svelte';
import { parseFixRequest, parseModelNotes } from '$lib/review/model-notes';
import type { FileDiff, ReviewChatMessage } from '@recoder/shared';

/** Quoted code on a model note is capped so a wide range cannot bloat the note. */
const MAX_QUOTE = 2000;

/**
 * Finished assistant replies that carry the given fenced block (```recoder-fix, ```recoder-note).
 * Called inside an effect it tracks each reply's status and text, since replies finish by updating in place.
 */
export function finishedReplies(messages: ReviewChatMessage[] | undefined, fence: string): ReviewChatMessage[] {
	return (messages ?? []).filter(
		(message) => message.from === 'assistant' && message.status === 'done' && message.text.includes(fence)
	);
}

/**
 * Starts the fixes a reply asked for (the same as Fix all, for those findings), once per reply.
 * The batch is recorded under the reply so the fixes show up in it.
 */
export function startRequestedFixes(replies: ReviewChatMessage[], handled: Set<string>): void {
	for (const message of replies) {
		if (handled.has(message.id)) continue;
		handled.add(message.id);

		const ids = parseFixRequest(message.text);

		if (!ids) continue;

		const open = findingsStore.items.filter((f) => f.status === 'open');

		const targets =
			ids === 'all'
				? open
				: open.filter((f) => ids.some((id) => id === f.id || id.toUpperCase() === f.code?.toUpperCase()));

		findingsStore.fixBatches[message.id] = targets.map((f) => f.id);
		if (targets.length) void fixFindings(targets);
	}
}

/** Turns the notes a reply wrote on request into diff notes, once per reply. */
export function addModelNotes(replies: ReviewChatMessage[], files: FileDiff[], handled: Set<string>): void {
	for (const message of replies) {
		if (handled.has(message.id)) continue;
		handled.add(message.id);

		for (const note of parseModelNotes(message.text)) {
			const file =
				files.find((f) => f.path === note.file) ??
				files.find((f) => f.path.endsWith(`/${note.file}`) || note.file.endsWith(`/${f.path}`));

			if (!file) continue;

			const lines = file.hunks
				.flatMap((hunk) => hunk.lines)
				.filter((line) => {
					const n = note.side === 'old' ? line.oldNo : line.newNo;

					return n !== null && n >= note.startLine && n <= note.endLine;
				});

			notesStore.add({
				file: file.path,
				startLine: note.startLine,
				endLine: note.endLine,
				side: note.side,
				body: note.body,
				quote: lines
					.map((line) => line.text)
					.join('\n')
					.slice(0, MAX_QUOTE)
			});
		}
	}
}
