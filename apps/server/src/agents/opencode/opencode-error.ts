/** Agent-facing failure with a message safe to show in the UI. */
export class OpenCodeError extends Error {
	constructor(
		message: string,
		readonly status = 502
	) {
		super(message);
		this.name = 'OpenCodeError';
	}
}
