'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { readSelection, writeSelection } from './link-dom';
import { imageIdsIn, imageToken, keepImageTokens, withoutImageTokens, type InlineImage } from './link-image';

interface InlineImagesInput {
	/** The caller's text: the words alone, with no image in them. */
	value: string;
	onValueChange: (value: string) => void;
	images: readonly InlineImage[];
	onRemoveImage: ((id: string) => void) | undefined;
	field: RefObject<HTMLElement | null>;
}

/** The field's side of a composer's images. */
interface InlineImages {
	/** What the field holds: the caller's words with each image's token where the person put it. */
	text: string;
	/** Takes the field's text after an edit: an image whose token went is removed, and the words go to the caller. */
	edit: (text: string) => void;
}

/**
 * Keeps a composer's images and the chips in its text in step. The caller
 * owns the words and the images; the field shows both, each image as a
 * token in the text (`imageToken`) drawn as an inline chip. A new image's
 * token goes in at the caret, or at the end when the field never had one,
 * and the caret goes after it. An image the caller drops takes its token
 * with it; a token the person deletes (Backspace over a chip, a cut)
 * removes its image. The caller never sees a token: `value` and
 * `onValueChange` carry the words alone.
 */
export function useInlineImages({
	value,
	onValueChange,
	images,
	onRemoveImage,
	field
}: InlineImagesInput): InlineImages {
	const [own, setOwn] = useState(value);
	const placed = useRef<ReadonlySet<string>>(new Set());
	const caret = useRef<number | null>(null);
	const text = followWords(own, value);

	/** Declared before the effect that sets it, so a caret waits for the commit that draws its token. */
	useLayoutEffect(() => {
		const root = field.current;
		const wanted = caret.current;

		caret.current = null;

		if (wanted === null || !root || root.ownerDocument.activeElement !== root) return;

		writeSelection(root, { anchor: wanted, focus: wanted });
	}, [text, field]);

	useLayoutEffect(() => {
		const held = new Set(images.map((image) => image.id));
		const added = images.filter((image) => !placed.current.has(image.id));
		const stray = imageIdsIn(text).some((id) => !held.has(id));

		placed.current = held;

		if (added.length === 0 && !stray) return;

		const at = caretIn(field.current, text);
		const tokens = added.map((image) => imageToken(image.id)).join('');

		caret.current = added.length > 0 ? keepImageTokens(text.slice(0, at), held).length + tokens.length : null;
		setOwn(keepImageTokens(text.slice(0, at) + tokens + text.slice(at), held));
	}, [images, text, field]);

	function edit(next: string): void {
		const held = new Set(images.map((image) => image.id));
		const kept = new Set(imageIdsIn(next));
		const cleaned = keepImageTokens(next, held);
		const words = withoutImageTokens(cleaned);

		for (const id of imageIdsIn(text)) if (held.has(id) && !kept.has(id)) onRemoveImage?.(id);

		setOwn(cleaned);

		if (words !== value) onValueChange(words);
	}

	return { text, edit };
}

/**
 * The field's text for the caller's words. While its own text holds them, it stands; words added after them (a path
 * appended) go after it; any other change from outside (a send that empties it, a command) takes the words as they
 * are, with the images' chips kept at the end.
 */
function followWords(own: string, words: string): string {
	const ownWords = withoutImageTokens(own);

	if (ownWords === words) return own;
	if (words.startsWith(ownWords)) return own + words.slice(ownWords.length);

	return words + imageIdsIn(own).map(imageToken).join('');
}

/** Where the caret sits in the field's text, or the end when the field holds no selection. */
function caretIn(root: HTMLElement | null, text: string): number {
	const selection = root ? readSelection(root) : null;

	return Math.min(selection?.focus ?? text.length, text.length);
}
