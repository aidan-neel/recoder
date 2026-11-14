import type { ChatTrailFile } from '@recoder/shared';
import type { CodeLine } from '@recoder/ui';

/** The file's text as numbered lines, with those a reference points at flagged. A final newline ends the last line; it does not start another. */
export function fileLines(text: string, reference: ChatTrailFile): CodeLine[] {
	const lines = text.split('\n');

	if (lines.length > 1 && lines.at(-1) === '') lines.pop();

	const first = reference.startLine ?? Infinity;
	const last = reference.endLine ?? first;

	return lines.map((line, index): CodeLine => ({
		type: 'context',
		oldNo: null,
		newNo: index + 1,
		text: line.replace(/\r$/, ''),
		flagged: index + 1 >= first && index + 1 <= last
	}));
}
