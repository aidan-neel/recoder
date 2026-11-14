import { expect, test } from 'bun:test';
import { z } from 'zod';
import { MAX_IMAGE_BYTES, type ImageUpload } from '@recoder/shared';
import {
	IMAGE_TOO_LARGE,
	imageProblem,
	imagesSchema,
	NOT_AN_IMAGE,
	TOO_MANY_IMAGES
} from '../../src/attachments/image-upload';
import { imageUpload, JPEG_BYTES, PNG_BYTES } from '../helpers/images';

const requestSchema = z.object({ images: imagesSchema });

/** What a request's `images` field comes to: the images Recoder keeps, or the message of the 400 that refuses it. */
function check(images: unknown): ImageUpload[] | string | null {
	const parsed = requestSchema.safeParse({ images });

	return parsed.success ? parsed.data.images : imageProblem(parsed.error);
}

/** A PNG of exactly `size` bytes. */
function pngOfSize(size: number): Buffer {
	const bytes = Buffer.alloc(size);

	PNG_BYTES.copy(bytes);

	return bytes;
}

test('a real image is kept, its name without folders or control characters', () => {
	const kept = check([imageUpload(PNG_BYTES, 'image/png', '../../etc/\u0000 shot.png ')]);

	expect(kept).toEqual([{ name: 'shot.png', type: 'image/png', data: PNG_BYTES.toString('base64') }]);
});

test('a request without images has none', () => {
	expect(check(undefined)).toEqual([]);
});

test('more than four images are refused', () => {
	expect(check(Array.from({ length: 5 }, () => imageUpload()))).toBe(TOO_MANY_IMAGES);
});

test('an image of exactly 5 MB is kept and one byte more is refused', () => {
	expect(check([imageUpload(pngOfSize(MAX_IMAGE_BYTES))])).toHaveLength(1);
	expect(check([imageUpload(pngOfSize(MAX_IMAGE_BYTES + 1))])).toBe(IMAGE_TOO_LARGE);
});

test('a file whose bytes are not its declared type is refused', () => {
	expect(check([imageUpload(JPEG_BYTES, 'image/png')])).toBe(NOT_AN_IMAGE);
});

test('a type Recoder does not take is refused', () => {
	expect(check([{ name: 'logo.svg', type: 'image/svg+xml', data: PNG_BYTES.toString('base64') }])).toBe(NOT_AN_IMAGE);
});

test('data that is not plain base64 is refused, a data URL prefix included', () => {
	const prefixed = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

	expect(check([{ ...imageUpload(), data: 'not base64!' }])).toBe(NOT_AN_IMAGE);
	expect(check([{ ...imageUpload(), data: prefixed }])).toBe(NOT_AN_IMAGE);
});
