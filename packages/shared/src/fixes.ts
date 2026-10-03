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
	/** Whether the patch applies cleanly to the review sandbox (null when none). */
	applies: boolean | null;
}
