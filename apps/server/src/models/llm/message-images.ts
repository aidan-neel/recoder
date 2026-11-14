import type { ImageUpload } from '@recoder/shared';
import type { ChatMessage } from './types';

/** An image as a `data:` URL, the inline form OpenAI-compatible servers and OpenCode take. */
export function imageDataUrl(image: ImageUpload): string {
	return `data:${image.type};base64,${image.data}`;
}

/** Every image on `turns`, oldest turn first: what a transport that sends the turns as one prompt attaches to it. */
export function turnImages(turns: readonly ChatMessage[]): ImageUpload[] {
	return turns.flatMap((turn) => turn.images ?? []);
}
