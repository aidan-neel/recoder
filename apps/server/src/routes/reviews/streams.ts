import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { expandFileDiff, parseUnifiedDiff, type Review } from '@recoder/shared';
import { readSandboxFile } from '../../review/pipeline/harness';
import { subscribeReview } from '../../review/session/events';
import { findReviewCheckout } from '../../review/session/review-checkout';
import { reviewDiffs } from '../../store';
import { TtlCache } from '../../util/ttl-cache';
import { requireReview } from './shared';
import { sharedEvents } from '../../storage/backend';
import { streamSharedReviewEvents } from './shared-stream';
import { EVENT_HEARTBEAT_MS, ReviewEventPayloads } from './event-payload';

const app = new Hono();

/**
 * Expanded diffs, briefly: the page polls while a review runs, and re-reading
 * every changed file each time is the slow part. Short enough that fixes
 * written to the checkout show up within seconds.
 */
const filesCache = new TtlCache<{ body: string; etag: string }>(10_000, 50);

/** The diff's files, each expanded to the whole file when the checkout has it. */
async function expandedFiles(diff: string, sandboxPath: string | null): Promise<{ body: string; etag: string }> {
	const files = parseUnifiedDiff(diff);

	const expanded = !sandboxPath
		? files
		: await Promise.all(
				files.map(async (file) => {
					const text = await readSandboxFile(sandboxPath, file.path, 400_000);

					if (!text || text.endsWith('…[truncated]')) return file;

					return expandFileDiff(file, text);
				})
			);

	const body = JSON.stringify(expanded);

	return { body, etag: `"${Bun.hash(body).toString(36)}"` };
}

/**
 * Stream a review's events to one client: a snapshot first, then every live
 * event, then a heartbeat every few seconds until the client leaves. It
 * subscribes before the snapshot's write finishes so no update falls between
 * them, and every write goes through one queue to keep them in order.
 */
async function streamReviewEvents(stream: SSEStreamingApi, review: Review): Promise<void> {
	if (sharedEvents) return streamSharedReviewEvents(stream, review, sharedEvents);

	const payloads = new ReviewEventPayloads(review);
	let writes = Promise.resolve();
	let failure: { error: unknown } | undefined;
	let wake: (() => void) | undefined;
	let unsubscribe: () => void = () => undefined;

	const send = (payload: () => Promise<unknown>) => {
		writes = writes.then(async () => {
			const data = await payload();

			if (!stream.aborted) await stream.writeSSE({ data: JSON.stringify(data) });
		});

		writes.catch((error) => {
			if (!stream.aborted) failure ??= { error };
			unsubscribe();
			wake?.();
		});

		return writes;
	};

	const initial = send(() => payloads.snapshot());

	unsubscribe = subscribeReview(
		review.id,
		(event) => {
			send(() => payloads.event(event));
		},
		false
	);

	stream.onAbort(() => {
		unsubscribe();
		wake?.();
	});

	try {
		await initial;

		while (!stream.aborted && !failure) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, EVENT_HEARTBEAT_MS);

				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});

			if (!stream.aborted && !failure) await send(() => payloads.heartbeat());
		}

		if (failure) throw failure.error;
	} finally {
		unsubscribe();
		wake?.();
	}
}

/** Parsed unified diff for a review (404 until the fetch step stores one), with an ETag so polls get 304. */
app.get('/:id/files', async (c) => {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	const diff = await reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 404);

	const sandboxPath = await findReviewCheckout(review);

	const { body, etag } = await filesCache.get(
		`${review.id}:${review.headSha}:${sandboxPath ?? ''}:${Bun.hash(diff)}`,
		() => expandedFiles(diff, sandboxPath)
	);

	c.header('ETag', etag);
	c.header('Cache-Control', 'private, no-cache');
	if (c.req.header('if-none-match') === etag) return c.body(null, 304);

	return c.body(body, 200, { 'content-type': 'application/json; charset=utf-8' });
});

/** Live pipeline events (fetch/sandbox/agent progress) as server-sent events. */
app.get('/:id/events', async (c) => {
	const review = await requireReview(c);

	if (review instanceof Response) return review;
	c.header('X-Accel-Buffering', 'no');

	const response = streamSSE(c, (stream) => streamReviewEvents(stream, review));

	response.headers.set('Cache-Control', 'no-cache, no-transform');

	return response;
});

export default app;
