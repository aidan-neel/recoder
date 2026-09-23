/**
 * Notes the orchestrator writes when asked: fenced ```recoder-note blocks with
 * JSON ({ file, startLine, endLine, side, body }) at the end of a reply. The
 * chat hides the blocks and the session page turns them into diff notes.
 */
export interface ModelNote {
	file: string;
	startLine: number;
	endLine: number;
	side: 'old' | 'new';
	body: string;
}

const BLOCK = /```recoder-note[^\n]*\n([\s\S]*?)```/g;

export function parseModelNotes(text: string): ModelNote[] {
	const notes: ModelNote[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(BLOCK)) {
		try {
			const raw = JSON.parse(match[1]) as Partial<ModelNote>;
			const startLine = Number(raw.startLine);
			const endLine = Number(raw.endLine ?? raw.startLine);
			if (typeof raw.file !== 'string' || !raw.file.trim() || typeof raw.body !== 'string' || !raw.body.trim()) continue;
			if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) continue;
			const note: ModelNote = { file: raw.file.trim(), startLine, endLine, side: raw.side === 'old' ? 'old' : 'new', body: raw.body.trim().slice(0, 4000) };
			// The model sometimes repeats a note (e.g. in both the text and the notes field).
			const key = JSON.stringify(note);
			if (seen.has(key)) continue;
			seen.add(key);
			notes.push(note);
		} catch {
			// Malformed block: leave it out rather than guess.
		}
	}
	return notes;
}

/** Reply text without note blocks, including one still streaming in. */
export function stripModelNotes(text: string): string {
	return text.replace(BLOCK, '').replace(/```recoder-note[\s\S]*$/, '').trimEnd();
}
