/** `info` is the lowest reported severity (a reviewer's "low"); informational notes are never reported. */
export type FindingSeverity = 'info' | 'warning' | 'error';

export interface FindingLocation {
	file: string;
	line?: number;
	endLine?: number;
	/** Diff side this location refers to. Defaults to `new` when a line exists. */
	side?: 'old' | 'new';
}

/** Whether a finding was proven by running code in the review sandbox. */
export interface FindingVerification {
	status: 'verified' | 'unverified';
	/** What the run showed, or why it could not be proven. */
	reason: string;
	/** `run`: a command's output proves it. `trace`: code could not run, and the verifier traced it through the code it read. */
	method?: 'run' | 'trace';
	/** The command whose output proves the finding. */
	command?: string;
	exitCode?: number | null;
}

export interface Finding {
	id: string;
	/** Short issue-specific heading. Older saved reviews may omit it. */
	title?: string;
	file: string;
	line?: number;
	/** Inclusive end of the range this finding refers to (defaults to `line`). */
	endLine?: number;
	severity: FindingSeverity;
	message: string;
	suggestion?: string;
	/** Reviewer role that produced this finding (e.g. `security`). */
	agent?: string;
	/** Model that produced this finding. */
	model?: string;
	/**
	 * Stability fingerprint: hash of file + category + normalized anchor
	 * code. Same issue re-found on a later run matches, so re-reviews only
	 * surface genuinely new findings.
	 */
	fingerprint?: string;
	/** Specialist assignment that produced this finding — never equal to the role id. */
	assignmentId?: string;
	category?: string;
	evidenceIds?: string[];
	relatedLocations?: FindingLocation[];
	/** Diff side for deleted-code findings. Defaults to `new` when a line exists. */
	side?: 'old' | 'new';
	verification?: FindingVerification;
}
