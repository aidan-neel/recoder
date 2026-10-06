/** `42` or `42–44`. */
export function lineLabel(startLine: number, endLine = startLine): string {
	return endLine > startLine ? `${startLine}–${endLine}` : `${startLine}`;
}

/**
 * Why a line has no row in the diff. The server expands each file to the whole file from the review's checkout,
 * so a line it could not show is outside the hunks with no checkout on disk.
 */
export function outsideDiffNote(startLine: number, endLine = startLine): string {
	const many = endLine > startLine;

	return `${many ? 'Lines' : 'Line'} ${lineLabel(startLine, endLine)} ${many ? 'are' : 'is'} outside the diff, and the review's checkout isn't available to show ${many ? 'them' : 'it'}.`;
}
