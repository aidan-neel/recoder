/** One patch hunk, or a metadata-only rename, in the order a person should read it. */
export interface DiffGuideHunk {
	id: string;
	file: string;
	explanation?: string;
	/** Deterministic movement context, never supplied by the model. */
	note?: string;
}

export interface DiffGuideGroup {
	id: string;
	title: string;
	explanation?: string;
	hunks: DiffGuideHunk[];
}

/** Presentation only: this order never changes review coverage or findings. */
export interface DiffGuide {
	source: 'deterministic' | 'model';
	groups: DiffGuideGroup[];
}
