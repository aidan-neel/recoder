import { SQL } from 'bun';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../../..');

export async function eventually(check: () => Promise<boolean>, message: string, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await check()) return;

		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}

	throw new Error(message);
}

function unusedPort(): number {
	const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
	const port = reservation.port;

	reservation.stop(true);

	if (!port) throw new Error('The test could not reserve a loopback port.');

	return port;
}

export class Replica {
	readonly url: string;
	private readonly process;
	private readonly output: Promise<string>;

	constructor(id: string, directory: string, databaseUrl: string) {
		const port = unusedPort();

		this.url = `http://127.0.0.1:${port}`;

		this.process = Bun.spawn([process.execPath, 'apps/server/src/index.ts'], {
			cwd: root,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			env: {
				...process.env,
				HOME: directory,
				XDG_CONFIG_HOME: join(directory, 'config'),
				GIT_CONFIG_GLOBAL: '/dev/null',
				GIT_CONFIG_NOSYSTEM: '1',
				GH_TOKEN: '',
				GITHUB_TOKEN: '',
				GITLAB_TOKEN: '',
				PORT: String(port),
				HOST: '127.0.0.1',
				RECODER_DATABASE_URL: databaseUrl,
				RECODER_INSTANCE_ID: id,
				RECODER_DATA_DIR: join(directory, 'data'),
				RECODER_WORKDIR: join(directory, 'work'),
				RECODER_JOB_LEASE_MS: '1000',
				RECODER_JOB_POLL_MS: '100',
				RECODER_EXEC: 'off',
				RECODER_OPENCODE_BIN: '',
				RECODER_CLAUDE_BIN: '',
				RECODER_DEVIN_BIN: '',
				RECODER_REVIEW_BASE_URL: '',
				RECODER_REVIEW_API_KEY: '',
				RECODER_REVIEW_MODEL: '',
				RECODER_LLM_RETRIES: '0'
			}
		});

		this.output = Promise.all([
			new Response(this.process.stdout).text(),
			new Response(this.process.stderr).text()
		]).then((parts) => parts.join('\n'));
	}

	async ready(): Promise<void> {
		try {
			await eventually(async () => {
				if (this.process.exitCode !== null) throw new Error(await this.output);

				return fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1000) })
					.then((response) => response.ok)
					.catch(() => false);
			}, 'The API replica did not become healthy.');
		} catch (error) {
			await this.kill();

			throw new Error(`${String(error)}\n${(await this.output).slice(-6000)}`, { cause: error });
		}
	}

	request(path: string, options: RequestInit = {}): Promise<Response> {
		return fetch(`${this.url}${path}`, {
			...options,
			headers: { 'content-type': 'application/json', ...options.headers },
			signal: options.signal ?? AbortSignal.timeout(5000)
		});
	}

	async json(path: string, options: RequestInit = {}): Promise<unknown> {
		const response = await this.request(path, options);

		if (!response.ok)
			throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);

		return response.json();
	}

	async kill(): Promise<void> {
		if (this.process.exitCode === null) this.process.kill('SIGKILL');

		await this.process.exited;
	}

	async logs(): Promise<string> {
		await this.kill();

		return this.output;
	}
}

export class HaProcesses {
	private readonly admin: SQL;
	private readonly databaseName = `recoder_ha_${crypto.randomUUID().replaceAll('-', '')}`;
	private readonly replicas: Replica[] = [];
	private directory = '';
	private created = false;
	readonly databaseUrl: string;
	readonly database: SQL;

	constructor(url: string) {
		const target = new URL(url);

		target.pathname = `/${this.databaseName}`;
		this.databaseUrl = target.href;
		this.admin = new SQL(url);
		this.database = new SQL(this.databaseUrl);
	}

	async initialize(): Promise<void> {
		this.directory = await mkdtemp(join(tmpdir(), 'recoder-ha-processes-'));
		await this.admin.unsafe(`CREATE DATABASE ${this.databaseName}`);
		this.created = true;
	}

	async start(id: string): Promise<Replica> {
		const directory = join(this.directory, id);

		await mkdir(directory);

		const replica = new Replica(id, directory, this.databaseUrl);

		this.replicas.push(replica);
		await replica.ready();

		return replica;
	}

	async close(): Promise<void> {
		await Promise.all(this.replicas.map((replica) => replica.kill()));
		await this.database.close();

		if (this.created) await this.admin.unsafe(`DROP DATABASE ${this.databaseName} WITH (FORCE)`);

		await this.admin.close();

		if (this.directory) await rm(this.directory, { recursive: true, force: true });
	}
}
