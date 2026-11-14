import type { ImageUpload } from '@recoder/shared';

/** What one `claude -p` process reads: the input flags it needs, and its stdin. */
interface ClaudeCodeInput {
	args: string[];
	stdin: string;
}

/**
 * The prompt as the CLI reads it. Plain text on stdin when it has no images; with images, one `stream-json` user
 * message whose content is an image block per image, then the text, as the Messages API takes them. The process
 * runs that one turn and exits when stdin closes.
 */
export function claudeCodeInput(text: string, images: readonly ImageUpload[]): ClaudeCodeInput {
	if (images.length === 0) return { args: [], stdin: text };

	const content = [
		...images.map((image) => ({
			type: 'image',
			source: { type: 'base64', media_type: image.type, data: image.data }
		})),
		{ type: 'text', text }
	];

	return {
		args: ['--input-format', 'stream-json'],
		stdin: `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`
	};
}
