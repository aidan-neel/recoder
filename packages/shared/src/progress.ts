export type ReviewTaskStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

/** Observable operations only: never model reasoning or generated response text. */
export interface ReviewTask {
	id: string;
	label: string;
	status: ReviewTaskStatus;
	message: string;
	agent?: string;
	model?: string;
	batch?: number;
	batches?: number;
	scout?: number;
	files?: string[];
	currentFile?: string;
	startedAt?: string;
	updatedAt: string;
	elapsedMs?: number;
}

export interface ReviewProgress {
	id: string;
	sequence: number;
	tasks: Record<string, ReviewTask>;
	activity: { sequence: number; message: string; at: string; agent?: string }[];
	updatedAt: string;
}

export function emptyReviewProgress(id: string): ReviewProgress {
	return { id, sequence: 0, tasks: {}, activity: [], updatedAt: '' };
}
