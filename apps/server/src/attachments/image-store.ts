import type { ImageType, ImageUpload, RepoChatMessage, StoredImage } from '@recoder/shared';
import { collection } from '../storage/backend';

/** What an image was attached to. Only that chat or review serves it, at a path under its own. */
export interface ImageOwner {
	kind: 'chat' | 'review';
	id: string;
}

/**
 * An image as stored: its bytes, in base64, in a row of its own. The chat or review that lists it keeps only the
 * small {@link StoredImage}, so the rows a chat rewrites while a reply streams stay small. The rows live in the same
 * storage as everything else, PostgreSQL when replicas share it, so every replica serves every image.
 */
export interface ImageRecord {
	id: string;
	owner: ImageOwner;
	name: string;
	type: ImageType;
	data: string;
}

/** The images a review's brief came with, kept by the review's id; the review record has no field for them. */
interface ReviewImages {
	id: string;
	images: StoredImage[];
}

const images = collection<ImageRecord>('images');
const reviewImageLists = collection<ReviewImages>('review_images');

/**
 * Saves `uploads` for `owner`, then runs `work` with what was saved. When `work` throws (the chat refused the
 * message), the images are deleted again, so a refused request leaves none behind.
 */
export async function withSavedImages<T>(
	owner: ImageOwner,
	uploads: readonly ImageUpload[],
	work: (images: StoredImage[]) => Promise<T>
): Promise<T> {
	const saved = await saveImages(owner, uploads);

	try {
		return await work(saved);
	} catch (error) {
		await deleteImages(saved.map((image) => image.id));
		throw error;
	}
}

/** The image `imageId` when `owner` owns it; undefined for an unknown id or another chat's or review's image. */
export async function ownedImage(owner: ImageOwner, imageId: string): Promise<ImageRecord | undefined> {
	const record = await images.get(imageId);

	return record?.owner.kind === owner.kind && record.owner.id === owner.id ? record : undefined;
}

/** The bytes of `stored`, `owner`'s images, as a model call takes them. Throws when one is gone. */
export async function imageUploads(owner: ImageOwner, stored: readonly StoredImage[]): Promise<ImageUpload[]> {
	return Promise.all(
		stored.map(async (image) => {
			const record = await ownedImage(owner, image.id);

			if (!record) throw new Error(`Image ${image.id} of ${owner.kind} ${owner.id} is missing from storage.`);

			return { name: record.name, type: record.type, data: record.data };
		})
	);
}

/** Saves the brief's images of a new review, and the list of them the review is read by. */
export async function saveReviewImages(reviewId: string, uploads: readonly ImageUpload[]): Promise<StoredImage[]> {
	if (uploads.length === 0) return [];

	const stored = await saveImages({ kind: 'review', id: reviewId }, uploads);

	await reviewImageLists.set({ id: reviewId, images: stored });

	return stored;
}

/** The review's brief images with their bytes, for the Review model; none when the brief had none. */
export async function reviewImageUploads(reviewId: string): Promise<ImageUpload[]> {
	const list = await reviewImageLists.get(reviewId);

	return list ? imageUploads({ kind: 'review', id: reviewId }, list.images) : [];
}

/** Deletes a deleted review's brief images and their list. */
export async function deleteReviewImages(reviewId: string): Promise<void> {
	const list = await reviewImageLists.get(reviewId);

	if (!list) return;

	await deleteImages(list.images.map((image) => image.id));
	await reviewImageLists.delete(reviewId);
}

/** Deletes the images a deleted chat's messages carried. */
export async function deleteChatImages(messages: readonly RepoChatMessage[]): Promise<void> {
	await deleteImages(messages.flatMap((message) => (message.images ?? []).map((image) => image.id)));
}

/** Saves each upload in a row of its own and returns what its owner keeps: ids, names, types and where each is served. */
async function saveImages(owner: ImageOwner, uploads: readonly ImageUpload[]): Promise<StoredImage[]> {
	const stored: StoredImage[] = [];

	for (const upload of uploads) {
		const record: ImageRecord = { id: crypto.randomUUID(), owner, ...upload };

		await images.set(record);
		stored.push(storedImage(record));
	}

	return stored;
}

/** Deletes the images `ids`; one already gone is skipped. */
async function deleteImages(ids: readonly string[]): Promise<void> {
	for (const id of ids) await images.delete(id);
}

/** What the owner keeps of a stored image, served under the owner's own path. */
function storedImage({ id, owner, name, type }: ImageRecord): StoredImage {
	const base = owner.kind === 'chat' ? '/api/chats' : '/api/reviews';

	return { id, name, type, url: `${base}/${encodeURIComponent(owner.id)}/images/${encodeURIComponent(id)}` };
}
