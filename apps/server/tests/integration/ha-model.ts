import { fakeReviewer, type FakeRequest } from '../helpers/fake-reviewer';

export class HaModel {
	readonly requests: FakeRequest[] = [];
	private readonly server;
	private readonly answer = fakeReviewer(this.requests);
	private release = () => {};
	private readonly gate = new Promise<void>((resolve) => {
		this.release = resolve;
	});

	private holding = true;
	blocked = false;

	constructor() {
		this.server = Bun.serve({
			port: 0,
			hostname: '127.0.0.1',
			idleTimeout: 0,
			fetch: (request) => this.respond(request)
		});
	}

	get url(): string {
		return `http://127.0.0.1:${this.server.port}/v1`;
	}

	private async respond(request: Request): Promise<Response> {
		if (request.method === 'GET') {
			return Response.json({ data: [{ id: 'ha-lead' }, { id: 'ha-worker' }] });
		}

		const response = await this.answer(request.url, { method: 'POST', body: await request.text() });

		if (this.holding && this.requests.at(-1)?.kind === 'reviewer') {
			this.blocked = true;
			await this.gate;
		}

		return response;
	}

	resume(): void {
		this.holding = false;
		this.release();
	}

	async close(): Promise<void> {
		this.resume();
		await this.server.stop(true);
	}
}
