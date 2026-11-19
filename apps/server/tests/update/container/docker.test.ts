import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerUpdates } from '../../../src/update/container/docker';
import type { ContainerRelease } from '../../../src/update/container/releases';

const NAME = 'recoder-server';
const ORIGINAL = 'a'.repeat(64);
const IMAGE = 'ghcr.io/aidan-neel/recoder';
const INDEX = `${IMAGE}@sha256:${'1'.repeat(64)}`;
const AMD64 = `${IMAGE}@sha256:${'2'.repeat(64)}`;

const release: ContainerRelease = {
	version: '0.4.0',
	channel: 'stable',
	releasedAt: '2026-11-19T01:02:03Z',
	notes: '',
	minVersion: '0.1.0',
	dataVersion: 1,
	oldestDataVersion: 0,
	image: INDEX,
	platform: 'linux/amd64',
	platformImage: AMD64
};

type Container = Record<string, unknown>;

let directory: string;
let server: ReturnType<typeof Bun.serve>;
let containers: Map<string, Container>;
let pulled: { RepoDigests: string[]; Os: string; Architecture: string };
let changes: string[];
let inspectedImages = 0;
let created: Record<string, unknown>[];

function managed(
	overrides: { name?: string; labels?: Record<string, string>; host?: Container; mounts?: Container[] } = {}
) {
	return {
		Id: ORIGINAL,
		Name: `/${overrides.name ?? NAME}`,
		Image: `sha256:${'b'.repeat(64)}`,
		Config: { Labels: overrides.labels ?? { 'dev.recoder.updater-managed': 'true' }, Env: [] },
		HostConfig: overrides.host ?? {},
		NetworkSettings: { Networks: { recoder: { Aliases: [NAME], IPAddress: '127.0.0.1' } } },
		Mounts: [
			{ Type: 'volume', Source: '/var/lib/docker/volumes/data', Destination: '/app/data', Name: 'data', RW: true },
			...(overrides.mounts ?? [])
		]
	};
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'recoder-docker-'));

	server = Bun.serve({
		unix: join(directory, 'docker.sock'),
		async fetch(request) {
			const url = new URL(request.url);
			const inspect = /^\/containers\/([^/]+)\/json$/.exec(url.pathname);

			if (request.method === 'GET' && inspect) {
				const found = containers.get(decodeURIComponent(inspect[1]));

				return found ? Response.json(found) : new Response(null, { status: 404 });
			}

			if (request.method === 'GET' && url.pathname === `/images/${encodeURIComponent(AMD64)}/json`)
				return (inspectedImages++, Response.json(pulled));

			changes.push(`${request.method} ${url.pathname}${url.search}`);

			if (url.pathname === '/containers/create') {
				created.push((await request.json()) as Record<string, unknown>);

				return Response.json({ Id: 'c'.repeat(64) }, { status: 201 });
			}

			if (url.pathname === '/images/create') return new Response('{"status":"done"}\n');

			return new Response(null, { status: 204 });
		}
	});
});

afterAll(async () => {
	await server.stop(true);
	await rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
	containers = new Map();
	pulled = { RepoDigests: [AMD64], Os: 'linux', Architecture: 'amd64' };
	changes = [];
	created = [];
	inspectedImages = 0;
});

function driver() {
	return dockerUpdates({
		socket: join(directory, 'docker.sock'),
		name: NAME,
		healthOrigin: 'http://recoder-server:3001',
		dataDirectory: directory
	});
}

test('a managed, unprivileged container is recreated from the platform digest with every capability dropped', async () => {
	containers.set(ORIGINAL, managed());

	await driver().startCandidate(ORIGINAL, release);

	expect(created[0]).toMatchObject({
		Image: AMD64,
		HostConfig: { CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: 'recoder' }
	});
});

test.each([
	['an extra mount', managed({ mounts: [{ Type: 'bind', Source: '/etc', Destination: '/host-etc', RW: false }] })],
	[
		'the Docker socket',
		managed({
			mounts: [{ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/run/recoder-updater', RW: true }]
		})
	],
	['a privileged flag', managed({ host: { Privileged: true } })],
	['an added capability', managed({ host: { CapAdd: ['SYS_ADMIN'] } })],
	['the host network', managed({ host: { NetworkMode: 'host' } })],
	['a missing managed label', managed({ labels: {} })],
	['a container outside the update lineage', managed({ name: 'other-app' })],
	['a previous container saved for another original', managed({ name: `${NAME}-previous-${'d'.repeat(12)}` })]
])('the driver refuses %s without changing any container', async (_, container) => {
	containers.set(ORIGINAL, container);

	await expect(driver().startCandidate(ORIGINAL, release)).rejects.toThrow(/isolated data mount|update lineage/);
	expect(changes).toEqual([]);
});

test('a running container outside the lineage is not removed during recovery', async () => {
	containers.set(ORIGINAL, managed({ name: `${NAME}-previous-${ORIGINAL.slice(0, 12)}` }));
	containers.set(NAME, { ...managed({ labels: {} }), Id: 'e'.repeat(64) });

	await expect(driver().recover(ORIGINAL, 'e9c96088-f728-4925-8cf3-fa082bc40760')).rejects.toThrow(
		'isolated data mount'
	);

	expect(changes).toEqual([]);
});

test('the image pull uses the signed platform digest and accepts the matching image', async () => {
	await driver().pull(release);

	expect(changes).toEqual([
		`POST /images/create?${new URLSearchParams({ fromImage: AMD64, platform: 'linux/amd64' })}`
	]);

	expect(inspectedImages).toBe(1);
});

test.each([
	['only the index digest', { RepoDigests: [INDEX], Os: 'linux', Architecture: 'amd64' }],
	['another platform', { RepoDigests: [AMD64], Os: 'linux', Architecture: 'arm64' }]
])('the pull is refused when the local image carries %s', async (_, image) => {
	pulled = image;

	await expect(driver().pull(release)).rejects.toThrow('signed digest for this platform');
});
