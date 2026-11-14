import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { MAX_IMAGES, type ImageUpload } from '@recoder/shared';
import { imageRefusal } from '../agents/registry';
import { ownedImage, type ImageOwner, type ImageRecord } from './image-store';
import { IMAGE_TOO_LARGE, MAX_IMAGE_BASE64_CHARS, TOO_MANY_IMAGES } from './image-upload';

/** Room in a request for its text and JSON beside the images. */
const TEXT_ROOM_BYTES = 1024 * 1024;

/** A browser may keep an image for a year: the bytes behind an image id never change. */
const IMAGE_CACHE = 'private, max-age=31536000, immutable';

const idSchema = z.string().min(1).max(200);
const imagePathSchema = z.object({ ownerId: idSchema, imageId: idSchema });

/**
 * The body limit of a route that takes images: `MAX_IMAGES` at the size limit, as base64, and the message's text.
 * A larger body is refused before it is read in full.
 */
export const imageBodyLimit = bodyLimit({
	maxSize: MAX_IMAGES * MAX_IMAGE_BASE64_CHARS + TEXT_ROOM_BYTES,
	onError: (c) => c.json({ error: `${TOO_MANY_IMAGES} ${IMAGE_TOO_LARGE}` }, 413)
});

/** The 400 for images the model cannot read, or null when there are none or the model reads them. */
export function refuseUnreadImages(
	c: Context,
	images: readonly ImageUpload[],
	provider: string | undefined
): Response | null {
	const refusal = images.length ? imageRefusal(provider) : null;

	return refusal ? c.json({ error: refusal }, 400) : null;
}

/**
 * Serves the image `:imageId` of the chat or review `:id`, or a 404 when that chat or review does not own it. The
 * ids only key stored records, so no id reaches a file path.
 */
export async function serveImage(c: Context, kind: ImageOwner['kind']): Promise<Response> {
	const path = imagePathSchema.safeParse({ ownerId: c.req.param('id'), imageId: c.req.param('imageId') });
	const record = path.success ? await ownedImage({ kind, id: path.data.ownerId }, path.data.imageId) : undefined;

	return record ? imageResponse(record) : c.json({ error: 'Image not found.' }, 404);
}

/** The image's bytes with its own type, which the browser must not second-guess. */
function imageResponse(record: ImageRecord): Response {
	return new Response(Buffer.from(record.data, 'base64'), {
		headers: {
			'Content-Type': record.type,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': IMAGE_CACHE,
			'Content-Disposition': `inline; filename*=UTF-8''${headerFileName(record.name)}`
		}
	});
}

/** `name` percent-encoded as RFC 5987 asks, which also encodes the `'()*` that `encodeURIComponent` leaves. */
function headerFileName(name: string): string {
	return encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
