import type { ReviewToolCall } from '@recoder/shared';

export type RevisionAlias = 'head' | 'target' | 'mergeBase';

export const REVISION_ALIASES: RevisionAlias[] = ['head', 'target', 'mergeBase'];

export const ACTION_NAMES = ['listFiles', 'readFile', 'search', 'readDiff', 'run', 'writeFile'] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export interface ReviewRevision {
	checkoutPath: string;
	checkoutKey?: string;
	headSha: string;
	targetSha: string;
	mergeBaseSha: string;
	targetRef: string;
}

export interface EvidenceRecord {
	id: string;
	revision: RevisionAlias;
	path: string;
	startLine: number;
	endLine: number;
	content: string;
	truncated: boolean;
	/** A command run in the review sandbox, rather than a read of repository content. */
	kind?: 'run';
	command?: string;
	exitCode?: number | null;
}

export interface EvidenceSnapshot {
	records: EvidenceRecord[];
	seq: number;
	toolSeq: number;
}

/** Observable tool/retrieval call reported to the live review dashboard. */
export type ToolCallReport = Omit<ReviewToolCall, 'assignmentId' | 'role'>;

/** One agent request: the dashboard's reported input, narrowed to known actions, plus `writeFile` content. */
export type RetrievalAction = Omit<NonNullable<ReviewToolCall['input']>, 'action'> & {
	action: ActionName;
	/** writeFile: full file content. */
	content?: string;
};

export interface ToolResult {
	action: string;
	ok: boolean;
	error?: string;
	evidenceId?: string;
	revision?: RevisionAlias;
	path?: string;
	startLine?: number;
	endLine?: number;
	content: string;
	truncated: boolean;
	continuation?: string | null;
	matches?: number;
	/** readDiff: the hunks whose patch text this result contains. */
	hunkIds?: string[];
	/** run: the command's exit code; null when it timed out or was stopped. */
	exitCode?: number | null;
}

/** A failed result with no content, for the many early-exit validation paths. */
export function failure(action: string, error: string, extra: Partial<ToolResult> = {}): ToolResult {
	return { action, ok: false, error, content: '', truncated: false, ...extra };
}
