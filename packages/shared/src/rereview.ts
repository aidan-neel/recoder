import type { Finding } from './findings';

/**
 * A developer comment anchored to a range of diff lines. The quoted snippet
 * travels with the note so the model can reason about the exact text even when
 * the file is later re-rendered or the line numbers drift.
 */
export interface RereviewNote {
	file: string;
	line: number;
	endLine: number;
	side: 'old' | 'new';
	/** Text the developer highlighted (may span multiple lines). */
	quote: string;
	/** The developer's comment. */
	body: string;
	/** New-side code for the anchored range. */
	newText?: string;
	/** Old-side code for the anchored range, when it touches deletions. */
	oldText?: string;
	/** Surrounding unified-diff lines. */
	diffContext?: string;
	/** The enclosing hunk header. */
	hunkHeader?: string;
}

export interface RereviewRequest {
	notes: RereviewNote[];
}

export type RereviewVerdict = 'valid' | 'invalid' | 'uncertain';

export interface RereviewAssessment {
	/** 0-based index into the request's `notes` array. */
	noteIndex: number;
	verdict: RereviewVerdict;
	response: string;
}

export interface RereviewResponse {
	agent: string;
	model: string;
	summary: string;
	assessments: RereviewAssessment[];
	/** New findings the notes surfaced; empty when nothing was added. */
	findings: Finding[];
}
