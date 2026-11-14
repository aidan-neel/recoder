import { z } from 'zod';
import { isImageType, MAX_IMAGE_BYTES, MAX_IMAGES, type ImageType, type ImageUpload } from '@recoder/shared';

const MEBIBYTE = 1024 * 1024;

export const TOO_MANY_IMAGES = `Attach at most ${MAX_IMAGES} images.`;
export const NOT_AN_IMAGE = 'That file is not a PNG, JPEG, WebP or GIF image.';
export const IMAGE_TOO_LARGE = `Images must be ${MAX_IMAGE_BYTES / MEBIBYTE} MB or smaller.`;

/** The longest base64 text of an image at the size limit; anything longer is refused before it is decoded. */
export const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** A stored name is cut to this many characters. */
const NAME_CHARS = 200;

/** The name an image gets when the one it came with is empty once cleaned. */
const UNNAMED = 'image';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The bytes each accepted type starts with: a file renamed to `.png` is refused. */
const SIGNATURES: Record<ImageType, (bytes: Buffer) => boolean> = {
	'image/png': (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	'image/jpeg': (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
	'image/gif': (bytes) => ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('latin1')),
	'image/webp': (bytes) =>
		bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
};

/**
 * One image as the app sends it, checked: a type Recoder accepts, valid base64 of at most `MAX_IMAGE_BYTES`, and
 * bytes that really are that type. The name loses any folders and control characters and is cut short.
 */
const imageUploadSchema = z
	.object({ name: z.string(), type: z.string(), data: z.string() })
	.transform((upload, context) => {
		const image = checkedImage(upload);

		if (typeof image === 'string') {
			context.addIssue({ code: 'custom', message: image });

			return z.NEVER;
		}

		return image;
	});

/** A request's images: at most `MAX_IMAGES`, each checked, none when the field is left out. */
export const imagesSchema = z.array(imageUploadSchema).max(MAX_IMAGES, TOO_MANY_IMAGES).default([]);

/** What is wrong with the request's images, for the 400 that refuses it; null when the problem is elsewhere. */
export function imageProblem(error: z.ZodError): string | null {
	return error.issues.find((issue) => issue.path[0] === 'images')?.message ?? null;
}

/** The upload as Recoder keeps it, when it is a real image of its declared type within the limit; else why not. */
function checkedImage({ name, type, data }: { name: string; type: string; data: string }): ImageUpload | string {
	if (!isImageType(type)) return NOT_AN_IMAGE;
	if (data.length > MAX_IMAGE_BASE64_CHARS) return IMAGE_TOO_LARGE;
	if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) return NOT_AN_IMAGE;

	const bytes = Buffer.from(data, 'base64');

	if (bytes.length > MAX_IMAGE_BYTES) return IMAGE_TOO_LARGE;
	if (!SIGNATURES[type](bytes)) return NOT_AN_IMAGE;

	return { name: cleanName(name), type, data };
}

/** The file name without folders or control characters, trimmed and cut to `NAME_CHARS`. */
function cleanName(name: string): string {
	const base = name.split(/[\\/]/).at(-1) ?? '';

	const clean = base
		.replace(/\p{Cc}/gu, '')
		.trim()
		.slice(0, NAME_CHARS);

	return clean || UNNAMED;
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
	return signature.every((byte, index) => bytes[index] === byte);
}
