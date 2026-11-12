import { z } from 'zod';

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

export class ReviewChatError extends Error {
	constructor(
		message: string,
		readonly status: 404 | 409 | 400
	) {
		super(message);
	}
}
