/**
 * A refusal the file routes answer as their own status. Anything else that
 * fails a git read is a plain error and becomes the app's 500.
 */
export class RepoFilesError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 502 | 503 | 504
	) {
		super(message);
	}
}

/** Git did not answer inside the request's budget. */
export function timedOut(): RepoFilesError {
	return new RepoFilesError('Reading the repository took too long; try again.', 504);
}
