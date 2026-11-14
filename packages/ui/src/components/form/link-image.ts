import type { TextRange } from './link-find';

/** An image a composer holds, as its field draws it inline and its tile row shows it. */
export interface InlineImage {
	id: string;
	name: string;
	/** Where the thumbnail loads from: an object URL for an image not yet sent. */
	src: string;
	/** The file's size in bytes. */
	bytes: number;
}

/**
 * The mark around an image's id in the field's text. U+FFFC is Unicode's object replacement character: the stand-in
 * for an object embedded in text, and never part of a link, so a token is never typed or read as words.
 */
const MARK = '￼';

/** A token: the mark, an id of letters, digits and dashes, the mark. */
const TOKEN = /￼([\w-]+)￼/gu;

/** The token that stands for an image in the field's text, where the person put it. */
export function imageToken(id: string): string {
	return `${MARK}${id}${MARK}`;
}

/** True when an embed's text is an image's token, not a link. */
export function isImageToken(text: string): boolean {
	return text.startsWith(MARK) && text.endsWith(MARK) && text.length > 2;
}

/** The id an image's token holds. */
export function imageIdOf(token: string): string {
	return token.slice(MARK.length, -MARK.length);
}

/** Every image token in the text, in order. */
export function findImageTokens(text: string): TextRange[] {
	return [...text.matchAll(TOKEN)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

/** The ids of the images the text holds, in order. */
export function imageIdsIn(text: string): string[] {
	return [...text.matchAll(TOKEN)].map((match) => match[1]);
}

/** The text with every image token taken out: the words a person wrote. */
export function withoutImageTokens(text: string): string {
	return text.replace(TOKEN, '');
}

/** The text with the tokens of images not in `kept` taken out. */
export function keepImageTokens(text: string, kept: ReadonlySet<string>): string {
	return text.replace(TOKEN, (token, id: string) => (kept.has(id) ? token : ''));
}

/** `840 B`, `13 KB`, `1.2 MB`: a file's size as a chip shows it. */
function byteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What makes two drawings of one image token the same. */
export function imageKey(image: InlineImage | undefined): string {
	return image ? [image.name, image.src, image.bytes].join('\u0000') : '';
}

/**
 * Fills an image embed: a small thumbnail, the file's name and its size, read out as one image with its name. An
 * image the field no longer holds shows a plain `Image`, until the composer takes its token out. Every string goes
 * in through `textContent` or an attribute, never as markup.
 */
export function fillImageEmbed(embed: HTMLElement, image: InlineImage | undefined): void {
	const name = document.createElement('span');

	embed.dataset.kind = 'image';
	embed.setAttribute('role', 'img');
	embed.setAttribute('aria-label', image ? `${image.name}, ${byteSize(image.bytes)}` : 'Image');
	name.dataset.ui = 'link-embed-label';
	name.textContent = image?.name ?? 'Image';

	if (!image) {
		embed.append(name);

		return;
	}

	const thumb = document.createElement('img');
	const size = document.createElement('span');

	thumb.dataset.ui = 'link-embed-thumb';
	thumb.alt = '';
	thumb.src = image.src;
	size.dataset.ui = 'link-embed-size';
	size.textContent = byteSize(image.bytes);
	embed.append(thumb, name, size);
}
