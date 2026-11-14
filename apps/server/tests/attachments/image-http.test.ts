import { expect, test } from 'bun:test';
import type { StoredImage } from '@recoder/shared';
import { app } from '../../src/app';
import {
	deleteReviewImages,
	reviewImageUploads,
	saveReviewImages,
	withSavedImages,
	type ImageOwner
} from '../../src/attachments/image-store';
import { imageUpload, PNG_BYTES } from '../helpers/images';

/** Saves one PNG for `owner` and returns what the owner keeps of it. */
async function savedImage(owner: ImageOwner): Promise<StoredImage> {
	const [image] = await withSavedImages(owner, [imageUpload()], async (saved) => saved);

	return image;
}

test('a chat serves its own image with its type, unsniffed and kept privately for long', async () => {
	const chatId = crypto.randomUUID();
	const image = await savedImage({ kind: 'chat', id: chatId });

	const response = await app.request(image.url);

	expect(image.url).toBe(`/api/chats/${chatId}/images/${image.id}`);
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('image/png');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(response.headers.get('cache-control')).toStartWith('private, max-age=');
	expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES);
});

test('an image is not found under another chat, nor under a review with its chat’s id', async () => {
	const chatId = crypto.randomUUID();
	const image = await savedImage({ kind: 'chat', id: chatId });

	const otherChat = await app.request(`/api/chats/${crypto.randomUUID()}/images/${image.id}`);
	const review = await app.request(`/api/reviews/${chatId}/images/${image.id}`);

	expect(otherChat.status).toBe(404);
	expect(review.status).toBe(404);
});

test('images saved for a request that is then refused are deleted again', async () => {
	const owner: ImageOwner = { kind: 'chat', id: crypto.randomUUID() };
	let url = '';

	const refused = withSavedImages(owner, [imageUpload()], async ([image]) => {
		url = image.url;
		throw new Error('This chat is full.');
	});

	await expect(refused).rejects.toThrow('This chat is full.');
	expect((await app.request(url)).status).toBe(404);
});

test('a review’s brief images reach its model and go with the review when it is deleted', async () => {
	const reviewId = crypto.randomUUID();
	const [image] = await saveReviewImages(reviewId, [imageUpload()]);

	expect(await reviewImageUploads(reviewId)).toEqual([imageUpload()]);
	expect((await app.request(image.url)).status).toBe(200);

	await deleteReviewImages(reviewId);

	expect(await reviewImageUploads(reviewId)).toEqual([]);
	expect((await app.request(image.url)).status).toBe(404);
});
