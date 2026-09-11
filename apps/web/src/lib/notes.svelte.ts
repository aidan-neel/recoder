/**
 * Developer review notes: comments anchored to a range of diff lines.
 *
 * Notes are collected client-side, then sent as one batch to the reviewer
 * models for a re-review pass (see `serverApi.rereview`). They are scoped to
 * the active review and cleared when the session changes.
 */

export interface ReviewNote {
	id: string;
	file: string;
	/** Anchor line on the given side (inclusive). */
	startLine: number;
	endLine: number;
	side: 'old' | 'new';
	/** Text the developer highlighted, kept so the model sees the exact code. */
	quote: string;
	/** The developer's comment. */
	body: string;
	createdAt: string;
	/** New-side code for the anchored range (context for the re-review pass). */
	newText?: string;
	/** Old-side code for the anchored range, when the range touches deletions. */
	oldText?: string;
	/** Surrounding unified-diff lines, so the model sees what changed. */
	diffContext?: string;
	/** The enclosing hunk header. */
	hunkHeader?: string;
}

export type NoteInput = Pick<
	ReviewNote,
	'file' | 'startLine' | 'endLine' | 'side' | 'quote' | 'body' | 'newText' | 'oldText' | 'diffContext' | 'hunkHeader'
>;
class NotesStore {
	items = $state<ReviewNote[]>([]);
	/** Backend review the notes belong to (null = local-only / no backend). */
	reviewId = $state<string | null>(null);
	/** Note currently being edited inline, if any. */
	editingId = $state<string | null>(null);

	get count(): number {
		return this.items.length;
	}

	add(input: NoteInput): string {
		const id = crypto.randomUUID();
		this.items.push({ ...input, id, createdAt: new Date().toISOString() });
		return id;
	}

	update(id: string, body: string): void {
		const note = this.items.find((item) => item.id === id);
		if (note) note.body = body;
	}

	remove(id: string): void {
		this.items = this.items.filter((item) => item.id !== id);
		if (this.editingId === id) this.editingId = null;
	}

	forFile(file: string): ReviewNote[] {
		return this.items.filter((item) => item.file === file);
	}

	clear(): void {
		this.items = [];
		this.reviewId = null;
		this.editingId = null;
	}
}

export const notesStore = new NotesStore();
