/** One part of a pull request, grouped by what the code does rather than by folder. */
export interface ChangeGroup {
	/** Stable within one description: g1, g2, and so on. */
	id: string;
	/** A few words, sentence case, no trailing period. */
	title: string;
	/** One plain sentence on what this group does. */
	note: string;
	/** Markdown, two to four sentences on how it works, with inline code for identifiers and file names. */
	explanation: string;
	/** Changed files in this group, in reading order. */
	paths: string[];
}

/** The AI description of one pull request at one head commit. */
export interface PullDescription {
	headSha: string;
	/** The model that wrote it, as the app shows it, and its effort when it has one. */
	model: { id: string; label: string; effort: string | null };
	/** Markdown, one to three sentences on what the PR does and why. */
	summary: string;
	/** Reading order; every changed file is in exactly one group. */
	groups: ChangeGroup[];
	/** Up to four short Markdown points a reviewer should know. */
	notes: string[];
	/** ISO timestamp. */
	createdAt: string;
}

export type PullDescriptionState =
	| { status: 'ready'; description: PullDescription }
	| { status: 'pending'; headSha: string; startedAt: string }
	| { status: 'failed'; headSha: string; error: string }
	| { status: 'unavailable'; reason: string };
