import { expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { ORCHESTRATOR_ID } from '@recoder/shared';
import { startLocalReview } from './local-review';
import { eventually, HaProcesses, type Replica } from './ha-processes';

class ChatModel {
	private gate: Promise<void> = Promise.resolve();
	private release = () => {};
	private hold = false;
	requests = 0;
	private readonly server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		idleTimeout: 0,
		fetch: async (request) => {
			if (request.method === 'GET') return Response.json({ data: [{ id: 'chat-model' }] });
			await request.json();
			this.requests++;

			if (this.hold) {
				this.hold = false;
				await this.gate;
			}

			return new Response(
				`data: ${JSON.stringify({ choices: [{ delta: { content: 'Shared answer.' } }] })}\n\ndata: [DONE]\n\n`,
				{ headers: { 'content-type': 'text/event-stream' } }
			);
		}
	});

	get url(): string {
		return `http://127.0.0.1:${this.server.port}/v1`;
	}

	blockNext(): void {
		this.hold = true;

		this.gate = new Promise((resolve) => {
			this.release = resolve;
		});
	}

	resume(): void {
		this.release();
	}

	async close(): Promise<void> {
		this.resume();
		await this.server.stop(true);
	}
}

const idSchema = z.object({ id: z.string() });
const messagesSchema = z.array(z.object({ id: z.string(), from: z.string(), status: z.string(), text: z.string() }));
const testUrl = process.env.RECODER_POSTGRES_TEST_URL;

test.skipIf(!testUrl)(
	'another API stops a live chat and recovers its next reply after the executor dies',
	async () => {
		if (!testUrl) return;

		const processes = new HaProcesses(testUrl);
		const model = new ChatModel();
		let fixtureDirectory: string | undefined;
		const replicas: Replica[] = [];

		try {
			const fixture = await startLocalReview(processes, replicas);
			const first = fixture.replica;

			fixtureDirectory = fixture.directory;

			const draft = fixture.review;

			await processes.database`UPDATE recoder_records SET value=jsonb_set(value,'{status}','"passed"') WHERE collection='reviews' AND id=${draft.id}`;

			await first.json('/api/settings/models', {
				method: 'PUT',
				body: JSON.stringify({
					baseUrl: model.url,
					apiKey: 'test',
					models: [{ id: 'chat-model', label: 'chat', model: 'chat-model' }],
					orchestratorModelId: 'chat-model',
					specialistModelId: 'chat-model'
				})
			});

			const second = await processes.start('replica-b');

			replicas.push(second);

			const messages = async () => {
				const rows = await processes.database<
					{ value: { messages?: unknown } }[]
				>`SELECT value FROM recoder_records WHERE collection='review_progress' AND id=${draft.id}`;

				return messagesSchema.parse(rows[0]?.value.messages ?? []);
			};

			const owner = async () => {
				const rows = await processes.database<
					{ owner_id: string | null }[]
				>`SELECT owner_id FROM review_actor_leases WHERE review_id=${draft.id}`;

				return rows[0]?.owner_id === 'replica-a' ? first : second;
			};

			model.blockNext();

			const stopped = idSchema.parse(
				await first.json(`/api/reviews/${draft.id}/chat`, {
					method: 'POST',
					body: JSON.stringify({ assignmentId: ORCHESTRATOR_ID, text: 'Explain this change.' })
				})
			);

			await eventually(async () => model.requests === 1, 'The first chat never reached the model.');

			const executor = await owner();
			const peer = executor === first ? second : first;

			const concurrent = await peer.request(`/api/reviews/${draft.id}/chat`, {
				method: 'POST',
				body: JSON.stringify({ assignmentId: ORCHESTRATOR_ID, text: 'A concurrent message.' })
			});

			expect(concurrent.status).toBe(409);

			await peer.json(`/api/reviews/${draft.id}/chat/stop`, {
				method: 'POST',
				body: JSON.stringify({ assignmentId: ORCHESTRATOR_ID })
			});

			await eventually(
				async () =>
					(await messages()).some((message) => message.id === `reply_${stopped.id}` && message.status === 'error'),
				'The remote stop did not persist the stopped reply.'
			);

			model.resume();
			expect((await messages()).filter((message) => message.id === stopped.id)).toHaveLength(1);

			await eventually(async () => {
				const pending = await processes.database<
					unknown[]
				>`SELECT command_id FROM review_actor_commands WHERE review_id=${draft.id} AND acknowledged_at IS NULL`;

				return pending.length === 0;
			}, 'The stopped conversation did not finish its durable command.');

			model.blockNext();

			const recovered = idSchema.parse(
				await peer.json(`/api/reviews/${draft.id}/chat`, {
					method: 'POST',
					body: JSON.stringify({ assignmentId: ORCHESTRATOR_ID, text: 'Explain it after failover.' })
				})
			);

			await eventually(async () => model.requests === 2, 'The next chat never reached the model.');

			const lost = await owner();
			const survivor = lost === first ? second : first;

			await lost.kill();
			model.resume();

			await eventually(
				async () =>
					(await messages()).some((message) => message.id === `reply_${recovered.id}` && message.status === 'done'),
				'The surviving replica did not recover the chat reply.'
			);

			expect((await messages()).filter((message) => message.id === recovered.id)).toHaveLength(1);
			expect((await messages()).find((message) => message.id === `reply_${recovered.id}`)?.text).toBe('Shared answer.');
			expect(await survivor.json(`/api/reviews/${draft.id}`)).toMatchObject({ status: 'passed' });
		} catch (error) {
			const logs = await Promise.all(replicas.map((replica) => replica.logs()));

			throw new Error(`${String(error)}\n${logs.map((log) => log.slice(-5000)).join('\n')}`, { cause: error });
		} finally {
			await model.close();
			await processes.close();
			if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
		}
	},
	30_000
);
