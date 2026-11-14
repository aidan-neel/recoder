'use client';

import { isImageType, MAX_IMAGE_BYTES, MAX_IMAGES, type ImageUpload } from '@recoder/shared';
import type { InlineImage } from '@recoder/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** An image waiting in a composer: its tile and chip, and what is sent. */
interface DraftImage extends InlineImage {
	upload: ImageUpload;
}

/** The images a composer holds until it sends, and why the last ones were refused. */
export interface ImageDraft {
	images: readonly DraftImage[];
	/** Why files were just refused: a type, a size or one too many; null once a later add or a remove is fine. */
	refusal: string | null;
	add: (files: File[]) => void;
	remove: (id: string) => void;
	/** Drops every image, after a send. */
	clear: () => void;
	/** What the request sends: each image's name, type and bytes. */
	uploads: () => ImageUpload[];
}

const NOT_AN_IMAGE = 'Attach a PNG, JPEG, WebP or GIF image.';
const TOO_LARGE = 'Images must be 5 MB or smaller.';
const TOO_MANY = `Attach at most ${MAX_IMAGES} images.`;

/**
 * Holds the images a composer will send. `add` takes files from the attach
 * button, a paste or a drop, keeps the ones Recoder accepts up to
 * `MAX_IMAGES`, and says why it left any out. Thumbnails are object URLs,
 * released when an image leaves or the composer unmounts.
 */
export function useImageDraft(): ImageDraft {
	const [images, setImages] = useState<readonly DraftImage[]>([]);
	const [refusal, setRefusal] = useState<string | null>(null);
	const latest = useRef(images);

	useEffect(() => {
		latest.current = images;
	}, [images]);

	useEffect(() => () => latest.current.forEach(release), []);

	const add = useCallback((files: File[]) => {
		const room = MAX_IMAGES - latest.current.length;
		const accepted = files.filter((file) => isImageType(file.type) && file.size <= MAX_IMAGE_BYTES).slice(0, room);

		setRefusal(refusalFor(files, accepted));

		Promise.all(accepted.map(draftImage)).then(
			(drafts) => setImages((current) => [...current, ...drafts].slice(0, MAX_IMAGES)),
			() => setRefusal('That image could not be read.')
		);
	}, []);

	const remove = useCallback((id: string) => {
		setRefusal(null);

		setImages((current) => {
			current.filter((image) => image.id === id).forEach(release);

			return current.filter((image) => image.id !== id);
		});
	}, []);

	const clear = useCallback(() => {
		setRefusal(null);

		setImages((current) => {
			current.forEach(release);

			return [];
		});
	}, []);

	const uploads = useCallback(() => latest.current.map((image) => image.upload), []);

	return useMemo(
		() => ({ images, refusal, add, remove, clear, uploads }),
		[images, refusal, add, remove, clear, uploads]
	);
}

/** Why some of `files` were left out, the first reason that applies; null when all were kept. */
function refusalFor(files: File[], accepted: File[]): string | null {
	if (accepted.length === files.length) return null;
	if (files.some((file) => !isImageType(file.type))) return NOT_AN_IMAGE;
	if (files.some((file) => file.size > MAX_IMAGE_BYTES)) return TOO_LARGE;

	return TOO_MANY;
}

/** Reads `file` into a draft: its bytes in base64 for the request, and an object URL for the chip. */
async function draftImage(file: File): Promise<DraftImage> {
	if (!isImageType(file.type)) throw new Error(NOT_AN_IMAGE);

	const data = await base64Of(file);

	return {
		id: crypto.randomUUID(),
		name: file.name || 'Pasted image',
		src: URL.createObjectURL(file),
		bytes: file.size,
		upload: { name: file.name || 'pasted-image', type: file.type, data }
	};
}

/** The file's bytes in base64, without the `data:<type>;base64,` prefix the reader puts first. */
function base64Of(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			const url = typeof reader.result === 'string' ? reader.result : '';

			resolve(url.slice(url.indexOf(',') + 1));
		};

		reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
		reader.readAsDataURL(file);
	});
}

function release(image: DraftImage): void {
	URL.revokeObjectURL(image.src);
}
