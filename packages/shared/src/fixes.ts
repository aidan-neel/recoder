export interface SuggestFixFinding {
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
}

export interface SuggestFixRequest {
	/** Reviewer role to author the fix (falls back to a default when unknown). */
	agent: string;
	finding: SuggestFixFinding;
}

/** One find-and-replace in a file; the server turns these into a patch against the current code. */
export interface FixEdit {
	file: string;
	/** Text copied verbatim from the file, long enough to match once. */
	find: string;
	replace: string;
}

export interface SuggestFixResponse {
	agent: string;
	model: string;
	summary: string;
	/** Unified diff patch (`a/` / `b/` prefixes, repo-rooted). */
	patch: string;
	/** The edits the patch was built from; applying rebuilds the patch from these against the latest code. */
	edits?: FixEdit[];
	/** Whether the patch applies cleanly to the review sandbox (null when none). */
	applies: boolean | null;
}

export interface ApplyFixRequest {
	/** The review finding this fixes; it is marked fixed once pushed. */
	findingId?: string;
	agent?: string;
	finding: SuggestFixFinding;
	summary: string;
	patch: string;
	edits?: FixEdit[];
}

/** A fix applied to the review checkout's working tree; nothing is committed or pushed. */
export interface ApplyFixResponse {
	/** Files the fix changed. */
	files: string[];
	/** PR head branch the changes will be pushed to. */
	branch: string;
}

/** One uncommitted file in a review checkout. */
export interface PendingFile {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	/** Unified diff against HEAD. */
	patch: string;
}

/** A local commit not yet pushed to the PR branch. */
export interface PendingCommit {
	sha: string;
	subject: string;
	author: string;
	at: string;
}

/** What the developer has changed in a review checkout and not yet pushed. */
export interface PendingChanges {
	files: PendingFile[];
	commits: PendingCommit[];
	/** PR head branch a push goes to. */
	branch?: string;
}
