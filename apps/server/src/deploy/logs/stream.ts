import type { LogLevel, LogLine, LogPage, LogSource } from '@recoder/shared';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import { z } from 'zod';
import { redacted } from '../../util/redact';

const LIMIT = 5_000;
const listeners = new Set<(line: LogLine) => void>();
const ring: Array<LogLine | undefined> = new Array(LIMIT);
let seq = Date.now() * 1000;
let size = 0;

export const logQuery = z.object({
	before: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().min(1).max(500).default(200),
	source: z.enum(['server', 'updater', 'proxy']).optional(),
	level: z.enum(['debug', 'info', 'warn', 'error']).optional()
});

/** Keep only explicitly selected operational lines; raw stdout can contain setup codes or forge diagnostics. */
export function serverLog(level: LogLevel, message: string, source: LogSource = 'server'): void {
	const line = {
		seq: ++seq,
		at: new Date().toISOString(),
		level,
		source,
		message: redacted(message, []).slice(0, 1000)
	};

	ring[seq % LIMIT] = line;
	size = Math.min(LIMIT, size + 1);
	for (const listen of listeners) listen(line);
}

export function readServerLogs(query: z.infer<typeof logQuery>): LogPage {
	const lines: LogLine[] = [];

	for (let id = Math.min((query.before ?? seq + 1) - 1, seq); id > seq - size; id--) {
		const line = ring[id % LIMIT];

		if (!line || (query.level && query.level !== line.level) || (query.source && query.source !== line.source))
			continue;
		if (lines.length === query.limit) return { lines, before: lines.at(-1)!.seq };
		lines.push(line);
	}

	return { lines, before: null };
}

export function streamServerLogs(c: Context): Response {
	return streamSSE(c, async (stream) => {
		let pending = 0;

		const send = (line: LogLine) => {
			if (pending >= 32) {
				stream.abort();

				return;
			}

			pending++;

			void stream
				.writeSSE({ event: 'line', id: String(line.seq), data: JSON.stringify(line) })
				.catch(() => stream.abort())
				.finally(() => pending--);
		};

		await new Promise<void>((done) => {
			listeners.add(send);

			const pulse = setInterval(() => {
				if (!pending) void stream.write(': keepalive\n\n').catch(() => stream.abort());
			}, 15_000);

			stream.onAbort(() => {
				clearInterval(pulse);
				listeners.delete(send);
				done();
			});
		});
	});
}
