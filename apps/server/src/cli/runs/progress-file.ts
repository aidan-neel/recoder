import { open } from 'node:fs/promises';
import { z } from 'zod';
import { errorCode } from '../exit.js';
import type { ProgressEvent } from '../progress.js';

const STAGES = ['checkout', 'understand', 'checks', 'reviewing', 'subagents', 'verify', 'consolidation'] as const;

const ASSIGNMENT_STATUSES = ['queued', 'waiting', 'running', 'done', 'error', 'skipped'] as const;

const budgetSchema = z.object({ used: z.number(), remaining: z.number(), reserved: z.number(), limit: z.number() });

const assignmentSchema = z.looseObject({
	id: z.string(),
	role: z.string(),
	title: z.string(),
	reason: z.string(),
	status: z.enum(ASSIGNMENT_STATUSES),
	scope: z.array(z.object({ path: z.string(), hunkIds: z.array(z.string()) })),
	candidateCount: z.number().optional(),
	currentOperation: z.string().optional()
});

/** One line of `progress.ndjson`. The file is read back from disk, so each line is parsed as outside input. */
const recordedEventSchema = z.intersection(
	z.object({ at: z.iso.datetime() }),
	z.discriminatedUnion('type', [
		z.object({ type: z.literal('stage'), stage: z.enum(STAGES) }),
		z.object({ type: z.literal('log'), message: z.string() }),
		z.object({ type: z.literal('assignment'), assignment: assignmentSchema }),
		z.object({ type: z.literal('budget'), budget: budgetSchema }),
		z.object({ type: z.literal('candidates'), count: z.number() })
	])
);

/** A progress event and when it happened, in milliseconds since the epoch. */
export interface RecordedEvent {
	at: number;
	event: ProgressEvent;
}

/**
 * Reads a run's progress file as it grows. Each call returns the events written since the last one. A line that is
 * still being written is kept for the next call, and a line that cannot be read as an event is skipped: the view
 * that follows a run must not stop over one bad line.
 */
export class ProgressFileReader {
	private offset = 0;

	private partial = '';

	constructor(private readonly path: string) {}

	async readNew(): Promise<RecordedEvent[]> {
		const text = this.partial + (await this.readFromOffset());
		const lines = text.split('\n');

		this.partial = lines.pop() ?? '';

		return lines.flatMap(parseRecordedEvent);
	}

	/** The bytes after the offset; nothing when the file does not exist yet, which is a run that has not reported. */
	private async readFromOffset(): Promise<string> {
		try {
			const file = await open(this.path, 'r');

			try {
				const { size } = await file.stat();
				const length = Math.max(0, size - this.offset);
				const { bytesRead, buffer } = await file.read(Buffer.alloc(length), 0, length, this.offset);

				this.offset += bytesRead;

				return buffer.subarray(0, bytesRead).toString('utf8');
			} finally {
				await file.close();
			}
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return '';

			throw error;
		}
	}
}

function parseRecordedEvent(line: string): RecordedEvent[] {
	const parsed = recordedEventSchema.safeParse(parseJsonOrNull(line));

	if (!parsed.success) return [];

	const { at, ...event } = parsed.data;

	return [{ at: Date.parse(at), event }];
}

function parseJsonOrNull(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}
