let sequence = 0;

/** An id for something made on this page before the server knows it (a question, a message on its way). */
export function localId(prefix: string): string {
	sequence += 1;

	return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
