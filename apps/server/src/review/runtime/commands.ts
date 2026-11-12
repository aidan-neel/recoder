import { z } from 'zod';
import { reviewCodeContextSchema } from '../chat/chat-input';

const id = z.string().min(1).max(200);

const control = z.object({ id, kind: z.enum(['start', 'continue', 'rerun', 'replay', 'pause', 'resume']) }).strict();

export const reviewCommandSchema = z.union([
	control,
	z.object({ id, kind: z.literal('cancel'), reason: z.string().min(1).max(1000).optional() }).strict(),
	z
		.object({
			id,
			kind: z.literal('chat'),
			messageId: id,
			assignmentId: id,
			text: z.string().trim().min(1).max(16_000),
			at: z.iso.datetime().optional(),
			codeContext: reviewCodeContextSchema.optional()
		})
		.strict(),
	z.object({ id, kind: z.literal('stop-chat'), assignmentId: id }).strict(),
	z.object({ id, kind: z.literal('prepare-draft'), opener: z.boolean() }).strict()
]);

export type ReviewCommand = z.infer<typeof reviewCommandSchema>;

export class CommandConflictError extends Error {
	constructor(commandId: string) {
		super(`Command ${commandId} already exists with different input. Use a new command ID.`);
		this.name = 'CommandConflictError';
	}
}

export const queuedCommandSchema = z.object({
	sequence: z.string().regex(/^[1-9][0-9]*$/),
	cancelled: z.boolean().default(false),
	command: reviewCommandSchema
});

export type QueuedCommand = z.infer<typeof queuedCommandSchema>;
