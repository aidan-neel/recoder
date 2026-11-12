import { expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { startLocalReview } from './local-review';
import { HaModel } from './ha-model';
import { eventually, HaProcesses, type Replica } from './ha-processes';

const recordSchema = z.object({ id: z.string() });
const reviewSchema = recordSchema.extend({ status: z.string(), summary: z.string().nullable() });

const settingsSchema = z.object({
	configured: z.boolean(),
	baseUrl: z.string(),
	orchestratorModelId: z.string().nullable()
});

const eventSchema = z.object({
	type: z.string(),
	sequence: z.number().int().nonnegative().optional(),
	data: z.record(z.string(), z.unknown()).optional()
});

class EventFeed {
	readonly events: z.infer<typeof eventSchema>[] = [];
	private readonly controller = new AbortController();
	private failure: unknown;
	private reading: Promise<void> = Promise.resolve();

	async open(replica: Replica, reviewId: string): Promise<void> {
		const response = await replica.request(`/api/reviews/${reviewId}/events`, { signal: this.controller.signal });

		if (!response.ok || !response.body) throw new Error(`The review event stream returned ${response.status}.`);

		this.reading = this.consume(response.body).catch((error: unknown) => {
			if (!this.controller.signal.aborted) this.failure = error;
		});
	}

	private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let pending = '';

		try {
			while (!this.controller.signal.aborted) {
				const { value, done } = await reader.read();

				if (done) return;

				pending += decoder.decode(value, { stream: true });

				const frames = pending.split(/\r?\n\r?\n/);

				pending = frames.pop() ?? '';

				for (const frame of frames) {
					const data = frame
						.split(/\r?\n/)
						.filter((line) => line.startsWith('data:'))
						.map((line) => line.slice(5).trim())
						.join('\n');

					if (data) this.events.push(eventSchema.parse(JSON.parse(data)));
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	containsPaused(paused: boolean): boolean {
		if (this.failure) throw this.failure;

		return this.events.some((event) => event.data?.paused === paused);
	}

	async close(): Promise<void> {
		this.controller.abort();
		await this.reading;
	}
}

const testUrl = process.env.RECODER_POSTGRES_TEST_URL;

test.skipIf(!testUrl)(
	'two API replicas share settings, stream remote progress, and finish a review after its executor dies',
	async () => {
		if (!testUrl) return;

		const processes = new HaProcesses(testUrl);
		const model = new HaModel();
		const feed = new EventFeed();
		const replicas: Replica[] = [];
		let fixtureDirectory: string | undefined;

		try {
			const fixture = await startLocalReview(processes, replicas);
			const first = fixture.replica;

			fixtureDirectory = fixture.directory;

			const draft = fixture.review;

			await first.json('/api/settings/models', {
				method: 'PUT',
				body: JSON.stringify({
					baseUrl: model.url,
					apiKey: 'ha-test-key',
					models: ['ha-lead', 'ha-worker'].map((id) => ({ id, label: id, model: id })),
					orchestratorModelId: 'ha-lead',
					specialistModelId: 'ha-worker',
					subagentCap: 3
				})
			});

			const second = await processes.start('replica-b');

			replicas.push(second);

			expect(settingsSchema.parse(await second.json('/api/settings/models'))).toEqual({
				configured: true,
				baseUrl: model.url,
				orchestratorModelId: 'ha-lead'
			});

			await first.json('/api/guidelines/global', {
				method: 'PUT',
				body: JSON.stringify({ content: 'Check changed contracts.' })
			});

			expect(await second.json('/api/guidelines')).toMatchObject({ global: { content: 'Check changed contracts.\n' } });

			const starts = await Promise.all(
				[first, second].map((replica) => replica.request(`/api/reviews/${draft.id}/start`, { method: 'POST' }))
			);

			expect(starts.map((response) => response.status).sort()).toEqual([202, 409]);
			await eventually(async () => model.blocked, 'The review never reached the deterministic model fixture.');

			const owners = await processes.database<
				{ owner_id: string }[]
			>`SELECT owner_id FROM review_actor_leases WHERE review_id = ${draft.id}`;

			const ownerId = z.enum(['replica-a', 'replica-b']).parse(owners[0]?.owner_id);
			const owner = ownerId === 'replica-a' ? first : second;
			const oldPeer = owner === first ? second : first;

			const metrics = z
				.object({ runs: z.array(z.unknown()) })
				.parse(await oldPeer.json(`/api/reviews/${draft.id}/metrics/stored`));

			expect(metrics.runs).toHaveLength(1);

			await oldPeer.kill();

			const peer = await processes.start('replica-peer');

			replicas.push(peer);
			expect(await peer.json(`/api/reviews/${draft.id}`)).toMatchObject({ status: 'running' });
			await feed.open(peer, draft.id);
			await peer.json(`/api/reviews/${draft.id}/pause`, { method: 'POST' });
			await eventually(async () => feed.containsPaused(true), 'The remote event stream did not observe the pause.');
			await peer.json(`/api/reviews/${draft.id}/resume`, { method: 'POST' });
			await eventually(async () => feed.containsPaused(false), 'The remote event stream did not observe the resume.');
			await owner.kill();
			model.resume();

			let result = reviewSchema.parse(await peer.json(`/api/reviews/${draft.id}`));

			await eventually(
				async () => {
					result = reviewSchema.parse(await peer.json(`/api/reviews/${draft.id}`));

					return result.status === 'passed' || result.status === 'failed';
				},
				'The surviving API did not finish the interrupted review.',
				30_000
			);

			expect(result).toMatchObject({ id: draft.id, status: 'passed' });

			const successor = await processes.database<
				{ owner_id: string; epoch: string }[]
			>`SELECT owner_id, epoch::text FROM review_actor_leases WHERE review_id = ${draft.id}`;

			expect(successor[0]?.epoch).not.toBe('1');
			expect(await peer.json('/api/guidelines')).toMatchObject({ global: { content: 'Check changed contracts.\n' } });

			const sequences = feed.events.flatMap((event) => (event.sequence === undefined ? [] : [event.sequence]));

			expect(sequences.length).toBeGreaterThan(2);
			expect(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1])).toBe(true);
		} catch (error) {
			model.resume();

			const logs = await Promise.all(replicas.map((replica) => replica.logs()));

			throw new Error(
				`${String(error)}\n${logs.map((log, index) => `replica ${index + 1}:\n${log.slice(-4000)}`).join('\n')}`,
				{ cause: error }
			);
		} finally {
			await feed.close();
			await model.close();
			await processes.close();

			if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
		}
	},
	80_000
);
