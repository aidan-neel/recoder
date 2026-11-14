/** The image types a message or a review brief may carry. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

/** The most images one message or review brief carries. */
export const MAX_IMAGES = 4;

/** The largest image, in bytes, before base64. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** An image the person attached, as the app sends it: the file's name, its type and its bytes in base64. */
export interface ImageUpload {
	name: string;
	type: ImageType;
	/** The image's bytes, base64-encoded, with no `data:` prefix. */
	data: string;
}

/**
 * An image the server keeps with a chat message or a review brief. Its bytes are served at `url`, a path on
 * the API (`/api/...`), so a message stays small when a chat or review is read.
 */
export interface StoredImage {
	id: string;
	name: string;
	type: ImageType;
	url: string;
}

/** True when `type` is an image type Recoder accepts. */
export function isImageType(type: string): type is ImageType {
	return IMAGE_TYPES.some((accepted) => accepted === type);
}
