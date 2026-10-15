import type { FileClass } from './files';
import type { Decision, DecisionState, Proof, Tone } from './surface';

export const TONE_LABEL: Record<Tone, string> = {
	high: 'High',
	medium: 'Medium',
	low: 'Low',
	question: 'Open question'
};

export const PROOF_LABEL: Record<Proof, string> = {
	reproduced: 'Reproduced',
	traced: 'Traced in code',
	checked: 'Checked',
	unproven: 'Not proven'
};

/** Model prose without its code marks, for single-line places (the rail, the palette). */
export function plain(text: string): string {
	return text.replace(/`([^`\n]+)`/g, '$1');
}

/** `error-handling` → `Error handling`. */
export function categoryLabel(category: string): string {
	const words = category.replace(/-/g, ' ');

	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `src/a/b.ts:12` or `src/a/b.ts:12-14`, with the directory dropped when `short`. */
export function where(file: string, line: number | null, endLine: number | null = null, short = false): string {
	const name = short ? file.slice(file.lastIndexOf('/') + 1) : file;

	if (line === null) return name;

	return endLine !== null && endLine !== line ? `${name}:${line}-${endLine}` : `${name}:${line}`;
}

export const CLASS_LABEL: Record<FileClass, string> = {
	read: 'Read',
	checked: 'Checked',
	tests: 'Tests',
	skim: 'Skim'
};

/** The glyph for a decision: its tone while open, then what was decided. */
export function decisionGlyph(decision: Decision, state: DecisionState): Tone | 'ok' | 'sent' | 'dismissed' {
	if (state === 'open') return decision.tone;

	return state === 'accepted' ? 'ok' : state;
}

export const STATE_LABEL: Record<DecisionState, string> = {
	open: 'Open',
	accepted: 'Accepted',
	sent: 'Sent back',
	dismissed: 'Not an issue'
};
