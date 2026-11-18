/** One `##` section of a docs page: its heading, an address fragment for it and the Markdown under it. */
interface DocSection {
	id: string;
	title: string;
	body: string;
}

/** A docs page's Markdown split at its `##` headings: what comes before the first one, then each section. */
export interface DocOutline {
	intro: string;
	sections: DocSection[];
}

const HEADING = /^## +(.+?) *$/;

/** The marker that opens or closes a fenced block: three or more backticks or tildes. */
const FENCE = /^(`{3,}|~{3,})/;

/** An address fragment for a heading: its letters and digits in lower case, joined by hyphens. */
function headingId(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** `id`, or `id-2`, `id-3` and so on when an earlier section of the page already has it. */
function uniqueId(id: string, taken: ReadonlySet<string>): string {
	if (!taken.has(id)) return id;

	let count = 2;

	while (taken.has(`${id}-${count}`)) count += 1;

	return `${id}-${count}`;
}

/** The fence a line leaves open: `open` until a line closes it, or the marker of a fence the line starts. */
function fenceAfter(line: string, open: string | null): string | null {
	const marker = FENCE.exec(line)?.[1];

	if (!marker) return open;

	if (!open) return marker;

	return marker[0] === open[0] && marker.length >= open.length ? null : open;
}

/**
 * Splits a page's Markdown at its `##` headings. A `##` line inside a fenced
 * block is code, not a heading. Every section gets an id that is unique on
 * the page, so the section list and the search can link to it.
 */
export function splitSections(body: string): DocOutline {
	const intro: string[] = [];
	const sections: { title: string; lines: string[] }[] = [];
	let fence: string | null = null;

	for (const line of body.split('\n')) {
		const title = fence ? undefined : HEADING.exec(line)?.[1];

		fence = fenceAfter(line, fence);

		if (title) sections.push({ title, lines: [] });
		else (sections.at(-1)?.lines ?? intro).push(line);
	}

	const taken = new Set<string>();

	return {
		intro: intro.join('\n').trim(),
		sections: sections.map(({ title, lines }) => {
			const id = uniqueId(headingId(title), taken);

			taken.add(id);

			return { id, title, body: lines.join('\n').trim() };
		})
	};
}
