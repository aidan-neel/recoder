import type { TextRange } from './link-find';
import { overlaps, touches, type LinkDoc } from './link-model';

/**
 * A `/` at the start or after white space, then a word. The same rule the server reads mentions by, so an embed
 * shows exactly the names a message attaches. An image's token mark ends the word.
 */
const MENTION = /(?<=^|\s)\/([^\s\uFFFC]+)/gu;

/** Punctuation that ends a sentence after a mention and is not part of the name: `use /migrations.` */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u;

/** True when an embed's text is a mention, not a link or an image's token: links all start with their scheme. */
export function isMentionText(text: string): boolean {
	return text.startsWith('/');
}

/** Every `/name` in the text whose name is one of `names`, in order: the `/` and the name, punctuation after it left out. */
export function findMentions(text: string, names: ReadonlySet<string>): TextRange[] {
	if (names.size === 0) return [];

	return [...text.matchAll(MENTION)].flatMap((match) => {
		const name = (match[1] ?? '').replace(TRAILING_PUNCTUATION, '');

		return names.has(name) ? [{ start: match.index, end: match.index + 1 + name.length }] : [];
	});
}

/**
 * The content with every mention of a known name as an embed, except one that touches `keep` (the word the caret is
 * typing in, so `/mig` never turns into an embed of a skill named `mig` half way to `/migrations`), and with no
 * mention embed whose name is no longer known. The same object when nothing changes.
 */
export function embedMentions(doc: LinkDoc, names: ReadonlySet<string>, keep: TextRange | null): LinkDoc {
	const kept = doc.links.filter((link) => !isStaleMention(doc.text, link, names));

	const added = findMentions(doc.text, names).filter(
		(mention) => !(keep && touches(keep, mention)) && !kept.some((embed) => overlaps(embed, mention))
	);

	if (added.length === 0 && kept.length === doc.links.length) return doc;

	return { text: doc.text, links: [...kept, ...added].sort((a, b) => a.start - b.start) };
}

/** True when an embed is a mention of a name not in `names`: one the host stopped offering. */
function isStaleMention(text: string, link: TextRange, names: ReadonlySet<string>): boolean {
	const embedded = text.slice(link.start, link.end);

	return isMentionText(embedded) && !names.has(embedded.slice(1));
}
