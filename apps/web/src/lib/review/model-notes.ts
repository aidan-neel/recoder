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

/** Valid notes in the reply, deduplicated (the model sometimes repeats one). Malformed blocks are left out. */
export function parseModelNotes(text: string): ModelNote[] {
	const notes: ModelNote[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(BLOCK)) {
		try {
			const raw = JSON.parse(match[1]) as Partial<ModelNote>;
			const startLine = Number(raw.startLine);
			const endLine = Number(raw.endLine ?? raw.startLine);

			if (typeof raw.file !== 'string' || !raw.file.trim() || typeof raw.body !== 'string' || !raw.body.trim())
				continue;
			if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) continue;

			const note: ModelNote = {
				file: raw.file.trim(),
				startLine,
				endLine,
				side: raw.side === 'old' ? 'old' : 'new',
				body: raw.body.trim().slice(0, 4000)
			};

			const key = JSON.stringify(note);

			if (seen.has(key)) continue;
			seen.add(key);
			notes.push(note);
		} catch {}
	}

	return notes;
}

const FIX_BLOCK = /```recoder-fix[^\n]*\n([\s\S]*?)```/;

/** A fix request the model made when asked (```recoder-fix {"findings": [...] | "all"}). A malformed block is ignored. */
export function parseFixRequest(text: string): string[] | 'all' | null {
	const match = FIX_BLOCK.exec(text);

	if (!match) return null;

	try {
		const raw = JSON.parse(match[1]) as { findings?: unknown };

		if (raw.findings === 'all') return 'all';

		if (Array.isArray(raw.findings)) {
			const ids = raw.findings.filter((id): id is string => typeof id === 'string' && id.trim() !== '').slice(0, 50);

			return ids.length ? ids : null;
		}
	} catch {}

	return null;
}

/** Reply text without note/fix blocks, including one still streaming in. */
export function stripModelNotes(text: string): string {
	return text
		.replace(BLOCK, '')
		.replace(new RegExp(FIX_BLOCK.source, 'g'), '')
		.replace(/```recoder-(note|fix)[\s\S]*$/, '')
		.trimEnd();
}
