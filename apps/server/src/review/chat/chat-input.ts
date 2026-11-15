import { z } from 'zod';
import type { ReviewCodeContext } from '@recoder/shared';

export const reviewCodeRangeSchema = z.object({
	file: z.string().trim().min(1).max(500),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive()
});

export const reviewCodeContextSchema = reviewCodeRangeSchema
	.extend({
		side: z.enum(['old', 'new']),
		quote: z.string().max(4000),
		diffContext: z.string().max(4000).optional()
	})
	.refine((context) => context.endLine >= context.startLine, { message: 'Invalid code range.' });

/** What a person attaches to a message besides its text. */
export interface ChatAttachments {
	codeContext?: ReviewCodeContext;
	/** Names of repository skills, read when the message is accepted. */
	skills?: string[];
}

export class ReviewChatError extends Error {
	constructor(
		message: string,
		readonly status: 404 | 409 | 400
	) {
		super(message);
	}
}
