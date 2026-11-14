import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageType, ImageUpload } from '@recoder/shared';

/** The file extension each accepted image type is saved with, so a CLI that reads the file knows its type. */
const EXTENSIONS: Record<ImageType, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

/**
 * Writes `images` into `directory` (a call's own scratch dir), owner-only like the rest of it, for a CLI that takes
 * images as files. Returns their paths, in order.
 */
export async function writeImageFiles(directory: string, images: readonly ImageUpload[]): Promise<string[]> {
	return Promise.all(
		images.map(async (image, index) => {
			const path = join(directory, `image-${index + 1}.${EXTENSIONS[image.type]}`);

			await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 });

			return path;
		})
	);
}
