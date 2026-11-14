import type { ImageType, ImageUpload } from '@recoder/shared';

/** The smallest bytes that pass as a PNG: its signature, then a little of anything. */
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** The smallest bytes that pass as a JPEG. */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

/** An image as the app uploads it: `bytes` in base64, declared as `type`. */
export function imageUpload(bytes: Buffer = PNG_BYTES, type: ImageType = 'image/png', name = 'bug.png'): ImageUpload {
	return { name, type, data: bytes.toString('base64') };
}
