/** Prefer authored titles; older saved findings use their opening heading or clause. */
export function findingTitle(body: string, supplied?: string): string {
	const plain = (value: string) => value
		.replace(/^\s{0,3}#{1,6}\s+/, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`+/g, '')
		.replace(/\*\*|__|~~/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const authored = plain(supplied ?? '');
	if (authored) return authored;
	const line = body.split('\n').find((value) => value.trim() && !value.trim().startsWith('```')) ?? '';
	// Punctuation inside code identifiers is not a sentence/clause boundary.
	const code: string[] = [];
	const masked = line.replace(/`+([^`]+)`+/g, (_, value: string) => {
		code.push(value);
		return `\uE000${code.length - 1}\uE001`;
	});
	const clause = masked.split(/[.!?](?:\s|$)|:\s|\s[—–]\s/, 1)[0];
	const title = plain(clause.replace(/\uE000(\d+)\uE001/g, (_, index: string) => code[Number(index)]));
	if (!title) return 'Review finding';
	if (title.length <= 96) return title;
	const excerpt = title.slice(0, 93);
	const boundary = excerpt.lastIndexOf(' ');
	return `${boundary > 48 ? excerpt.slice(0, boundary) : excerpt}…`;
}
