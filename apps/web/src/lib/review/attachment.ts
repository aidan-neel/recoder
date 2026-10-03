/** Longest message the composer sends, attached files included. */
export const MESSAGE_LIMIT = 8000;

/** Reads a text file into the block appended to a draft; throws a message for the developer when it is too large or not text. */
export async function attachmentText(file: File): Promise<string> {
	if (file.size > 32_000)
		throw new Error('Choose a text file under 32 KB. Messages can contain up to 8,000 characters.');

	const text = await file.text();

	// eslint-disable-next-line no-control-regex -- NUL and the replacement character mark a binary file
	if (/[\u0000�]/.test(text)) throw new Error('Choose a text or source code file.');

	return `\n\nAttached file: ${file.name}\n\n${text}`;
}
