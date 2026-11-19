import { expect, test } from 'bun:test';
import { createUpdater, emptyJournal, type Journal, type UpdateDocker } from '../../../src/update/container/controller';
import { updaterHandler, updaterTerminal } from '../../../src/update/container/protocol';
import { releaseSource, type ContainerRelease } from '../../../src/update/container/releases';

const ID = 'e9c96088-f728-4925-8cf3-fa082bc40760';
const ORIGINAL = { id: 'old', version: '0.3.0', dataVersion: 1 };
const NEW_VERSION = '0.4.0';
const TOKEN = 'fixture-token-that-is-not-used-outside-a-test';
const IMAGE = 'ghcr.io/aidan-neel/recoder';
const DIGEST = `sha256:${'a'.repeat(64)}`;

const release: ContainerRelease = {
	version: NEW_VERSION,
	channel: 'stable',
	releasedAt: '2026-11-19T01:02:03Z',
	notes: 'Release notes',
	minVersion: '0.1.0',
	dataVersion: 2,
	oldestDataVersion: 0,
	image: `${IMAGE}@${DIGEST}`,
	platform: 'linux/amd64'
};

function fixture(journal?: Journal, authorize: (version: string) => Promise<ContainerRelease> = async () => release) {
	const calls: string[] = [];
	let finished = () => {};
	const terminal = new Promise<void>((resolve) => (finished = resolve));

	const docker: UpdateDocker = {
		current: async () => ORIGINAL,
		backup: async (id) => ({ id, dataVersion: 1 }),
		pull: async () => void calls.push('pull'),
		startCandidate: async () => void calls.push('start candidate'),
		startWithBackup: async () => void calls.push('start with backup'),
		recover: async (original, backup) => void calls.push(`recover ${original} with ${backup}`),
		healthy: async (version) => {
			calls.push(`health ${version}`);

			return version === ORIGINAL.version;
		},
		finish: async () => void calls.push('remove previous')
	};

	const updater = createUpdater(
		{
			docker,
			authorize,
			write: async (next) => {
				if (updaterTerminal(next.state) && next.state !== 'idle') queueMicrotask(() => queueMicrotask(finished));
			}
		},
		journal
	);

	return { calls, updater, terminal };
}

function request(path: string, body?: unknown, token = TOKEN): Request {
	return new Request(`http://localhost/${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

test('a new image that fails readiness restores its prior backup and checks the old image', async () => {
	const { updater, terminal, calls } = fixture();

	await updater.start({ action: 'install', version: NEW_VERSION, checkpoint: ID, by: null });
	await terminal;

	expect(calls).toEqual(['pull', 'start candidate', `health ${NEW_VERSION}`, `recover old with ${ID}`, 'health 0.3.0']);
	expect(updater.status().update.current.version).toBe(ORIGINAL.version);
	expect(updater.status().update.state).toBe('rolled-back');
});

test('a rollback cannot start an older image without a matching pre-update backup', async () => {
	const base = emptyJournal();

	base.history = [
		{
			id: ID,
			version: '0.2.0',
			dataVersion: 0,
			outcome: 'replaced',
			rollback: 'restore',
			by: null,
			durationMs: null,
			installedAt: release.releasedAt
		}
	];

	const { updater, terminal, calls } = fixture(base, async () => ({ ...release, version: '0.2.0', dataVersion: 0 }));

	await updater.start({ action: 'rollback', version: '0.2.0', checkpoint: ID, by: null });
	await terminal;

	expect(calls).toEqual([]);
	expect(updater.status().update.error).toContain('original pre-update backup');
});

test('the authenticated socket exposes only its four verbs and rejects extra arguments', async () => {
	const handler = updaterHandler(TOKEN, fixture().updater);

	expect((await handler(request('status', undefined, 'bad-token'))).status).toBe(401);
	expect((await handler(request('status'))).status).toBe(200);
	expect((await handler(request('run', { command: 'not-an-action' }))).status).toBe(404);

	expect(
		(await handler(request('install', { version: NEW_VERSION, checkpoint: ID, by: null, image: 'not-allowed' }))).status
	).toBe(400);
});

test.each(['unlisted', 'unsigned manifest', 'unsigned image'])(
	'the updater does not pull an %s release',
	async (failure) => {
		let verifications = 0;

		const requests = (async (url: string) => {
			if (failure === 'unlisted') return new Response(null, { status: 404 });
			if (url.endsWith('.sig')) return new Response('fixture bundle');

			return Response.json({
				schemaVersion: 1,
				minDataVersion: 0,
				indexDigest: DIGEST,
				platforms: { 'linux/amd64': DIGEST },
				...release,
				image: IMAGE
			});
		}) as typeof fetch;

		const source = releaseSource('linux/amd64', requests, async (args) => {
			verifications++;

			expect(args).toContain(
				`https://github.com/aidan-neel/recoder/.github/workflows/release.yml@refs/tags/v${NEW_VERSION}`
			);

			return failure !== 'unsigned manifest' && args[0] !== 'verify';
		});

		const { updater, terminal, calls } = fixture(undefined, source.authorize);

		await updater.start({ action: 'install', version: NEW_VERSION, checkpoint: ID, by: null });
		await terminal;

		expect(verifications).toBe(failure === 'unlisted' ? 0 : failure === 'unsigned manifest' ? 1 : 2);
		expect(calls).toEqual([]);
		expect(updater.status().update.state).toBe('failed');
	}
);
