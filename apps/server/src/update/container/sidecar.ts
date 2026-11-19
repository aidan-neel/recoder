import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createUpdater, emptyJournal, type Journal } from './controller';
import { dockerUpdates } from './docker';
import { updaterHandler, type UpdaterStatus } from './protocol';
import { releaseSource } from './releases';

const socket = '/run/recoder-updater/control.sock';
const data = '/app/data';
const journalPath = '/var/lib/recoder-updater/journal.json';

const state = z.enum([
	'idle',
	'checking',
	'pausing',
	'backing-up',
	'updating',
	'restarting',
	'health-check',
	'resuming',
	'rolling-back',
	'rolled-back',
	'failed'
]);

const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/);

const container = z.object({
	id: z.string().regex(/^[a-f0-9]{64}$/),
	version,
	dataVersion: z.number().int().nonnegative()
});

const line = z.object({
	seq: z.number().int(),
	at: z.iso.datetime(),
	source: z.literal('updater'),
	level: z.enum(['info', 'error']),
	message: z.string()
});

const journalSchema = z.strictObject({
	format: z.literal(1),
	current: container.optional(),
	state,
	operation: z.enum(['update', 'rollback', 'restore']).optional(),
	error: z.string().optional(),
	checkpoint: z.uuid().optional(),
	pending: z.object({ original: container, checkpoint: z.uuid() }).optional(),
	steps: z
		.array(
			z.object({
				id: z.enum(['pause', 'backup', 'download', 'start', 'health']),
				state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
				detail: z.string().optional()
			})
		)
		.max(5),
	history: z
		.array(
			z.object({
				id: z.uuid(),
				version,
				dataVersion: z.number().int().nonnegative(),
				installedAt: z.iso.datetime(),
				by: z.string().max(200).nullable(),
				durationMs: z.number().int().nonnegative().nullable(),
				outcome: z.enum(['running', 'replaced', 'rolled-back', 'failed']),
				error: z.string().optional(),
				checkpoint: z.uuid().optional(),
				rollback: z.enum(['swap', 'restore', 'none'])
			})
		)
		.max(20),
	logs: z.record(z.uuid(), z.array(line).max(30))
});

async function readJournal(): Promise<Journal> {
	try {
		return journalSchema.parse(JSON.parse(await readFile(journalPath, 'utf8')));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyJournal();
		throw error;
	}
}

async function saveJournal(journal: Journal): Promise<void> {
	const directory = dirname(journalPath);
	const temporary = join(directory, `.journal-${crypto.randomUUID()}`);

	try {
		await writeFile(temporary, JSON.stringify(journal), { mode: 0o600, flag: 'wx', flush: true });
		await rename(temporary, journalPath);

		const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);

		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} finally {
		await rm(temporary, { force: true });
	}
}

async function start(): Promise<void> {
	process.umask(0o077);

	const token = (await readFile('/run/secrets/recoder-updater-token', 'utf8')).trim();
	const platform = process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';
	const source = releaseSource(platform);

	const docker = dockerUpdates({
		socket: '/var/run/docker.sock',
		name: 'recoder-server',
		healthOrigin: 'http://recoder-server:3001',
		dataDirectory: data
	});

	await mkdir(dirname(journalPath), { recursive: true, mode: 0o700 });
	await mkdir(dirname(socket), { recursive: true, mode: 0o700 });

	const updater = createUpdater({ docker, authorize: source.authorize, write: saveJournal }, await readJournal());
	let releases: UpdaterStatus['releases'];
	let lookingUpReleases = false;
	let lastCheck = 0;

	const handler = updaterHandler(token, {
		start: updater.start,
		status: () => {
			if (!lookingUpReleases && Date.now() - lastCheck > 5 * 60_000) {
				lastCheck = Date.now();
				lookingUpReleases = true;

				void source
					.latest()
					.then((found) => (releases = found))
					.catch(() => {})
					.finally(() => (lookingUpReleases = false));
			}

			return { ...updater.status(), releases, lookingUpReleases };
		}
	});

	await updater.recover();
	await updater.initialize();

	try {
		const current = await lstat(socket);

		if (!current.isSocket()) throw new Error('Updater control path already exists and is not a socket.');

		await rm(socket);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	Bun.serve({ unix: socket, fetch: handler, maxRequestBodySize: 4096 });
	await chmod(socket, 0o600);
}

try {
	await start();
} catch (error) {
	console.error('[updater] could not start', error instanceof Error ? error.name : typeof error);
	process.exitCode = 1;
}
