import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import type { RunningContainer, UpdateDocker } from './controller';
import { UpdaterRefused } from './protocol';

const LOCAL_IMAGE = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const DATA_PATH = '/app/data';
const archiveName = 'backup.tar.zst';
const MANAGED_LABEL = 'dev.recoder.updater-managed';
const HELPER_LABEL = 'dev.recoder.updater-helper';

const APP_MOUNTS = new Set([
	DATA_PATH,
	'/app/config',
	'/tmp/recoder-work',
	'/run/recoder-updater',
	'/run/secrets/recoder-updater-token'
]);

const originalName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,100}$/;

const inspection = z.object({
	Id: z.string().regex(CONTAINER_ID),
	Name: z.string(),
	Image: z.string().regex(LOCAL_IMAGE),
	Config: z.record(z.string(), z.unknown()),
	HostConfig: z.record(z.string(), z.unknown()),
	NetworkSettings: z.object({
		Networks: z.record(
			z.string(),
			z.object({
				Aliases: z.array(z.string()).nullish(),
				IPAddress: z.string().optional(),
				GlobalIPv6Address: z.string().optional()
			})
		)
	}),
	Mounts: z.array(
		z.object({
			Type: z.enum(['bind', 'volume', 'tmpfs']),
			Source: z.string(),
			Destination: z.string(),
			Name: z.string().optional(),
			RW: z.boolean()
		})
	)
});

type Inspection = z.infer<typeof inspection>;

const pulledImage = z.object({ RepoDigests: z.array(z.string()), Os: z.string(), Architecture: z.string() });

interface Options {
	socket: string;
	name: string;
	healthOrigin: string;
	dataDirectory: string;
}

function safeOrigin(value: string): string {
	const url = new URL(value);

	if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
		throw new Error('Set a private HTTP origin for Recoder readiness checks.');

	return url.origin;
}

/** The configured container and its existing data mount are the only Docker resources this driver changes. */
export function dockerUpdates(options: Options): UpdateDocker {
	if (!originalName.test(options.name)) throw new Error('Invalid managed Recoder container name.');

	const origin = safeOrigin(options.healthOrigin);

	async function send(method: string, path: string, body?: unknown, timeout = 30_000): Promise<Response> {
		return fetch(`http://localhost${path}`, {
			unix: options.socket,
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeout)
		});
	}

	async function required(response: Response, detail: string): Promise<Response> {
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			throw new UpdaterRefused(detail);
		}

		return response;
	}

	async function inspect(container = options.name, missing = false): Promise<Inspection | undefined> {
		const response = await send('GET', `/containers/${encodeURIComponent(container)}/json`);

		if (missing && response.status === 404) {
			await response.body?.cancel().catch(() => {});

			return undefined;
		}

		await required(response, 'The configured Recoder container is not available.');

		const parsed = inspection.safeParse(await response.json());

		if (!parsed.success) throw new UpdaterRefused('The configured Recoder container has an unsupported configuration.');

		return parsed.data;
	}

	async function stop(id: string): Promise<void> {
		const response = await send('POST', `/containers/${id}/stop?t=25`, undefined, 35_000);

		if (response.status !== 304) await required(response, 'Docker could not stop the Recoder container.');
	}

	async function rename(id: string, name: string): Promise<void> {
		await required(
			await send('POST', `/containers/${id}/rename?name=${encodeURIComponent(name)}`),
			'Docker could not reserve the Recoder container name.'
		);
	}

	async function start(id: string): Promise<void> {
		const response = await send('POST', `/containers/${id}/start`);

		if (response.status !== 304) await required(response, 'Docker could not start the Recoder container.');
	}

	async function remove(id: string): Promise<void> {
		const response = await send('DELETE', `/containers/${id}`);

		if (response.status !== 404) await required(response, 'Docker could not remove a stopped update container.');
	}

	async function create(name: string, config: Record<string, unknown>): Promise<string> {
		const response = await required(
			await send('POST', `/containers/create?name=${encodeURIComponent(name)}`, config),
			'Docker could not create a Recoder container.'
		);

		const id = ((await response.json()) as { Id?: unknown }).Id;

		if (typeof id !== 'string' || !CONTAINER_ID.test(id))
			throw new UpdaterRefused('Docker returned an invalid container id.');

		return id;
	}

	async function readHealth(container: Inspection): Promise<Omit<RunningContainer, 'id'> | undefined> {
		try {
			const network = Object.values(container.NetworkSettings.Networks).find((entry) =>
				entry.Aliases?.includes(options.name)
			);

			const ip = network?.IPAddress || network?.GlobalIPv6Address;
			const family = ip ? isIP(ip) : 0;

			if (!family) return undefined;

			const address = new URL(origin);

			address.hostname = family === 6 ? `[${ip}]` : ip!;

			const [health, readiness] = await Promise.all(
				['/health', '/health/ready'].map((path) =>
					fetch(new URL(path, address), { redirect: 'error', signal: AbortSignal.timeout(2000) })
				)
			);

			if (!health.ok || !readiness.ok) return undefined;

			const identity = z.object({ version: z.string(), name: z.literal('recoder') }).safeParse(await health.json());

			const ready = z
				.object({ ok: z.literal(true), dataVersion: z.number().int().nonnegative() })
				.safeParse(await readiness.json());

			if (identity.success && ready.success)
				return { version: identity.data.version, dataVersion: ready.data.dataVersion };
		} catch {
			return undefined;
		}
	}

	async function backup(id: string): Promise<{ id: string; dataVersion: number }> {
		const uuid = z.uuid().safeParse(id);

		if (!uuid.success) throw new UpdaterRefused('Use an existing Recoder backup.');

		const root = join(options.dataDirectory, 'backups');
		const directory = join(root, id);

		try {
			if (!(await lstat(root)).isDirectory() || !(await lstat(directory)).isDirectory())
				throw new Error('not confined');
			if (!(await lstat(join(directory, archiveName))).isFile()) throw new Error('not a file');

			const file = await open(
				join(directory, 'manifest.json'),
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
			);

			try {
				const info = await file.stat();

				if (!info.isFile() || info.size > 4096) throw new Error('invalid metadata');

				return z
					.object({
						id: z.literal(id),
						dataVersion: z.number().int().nonnegative(),
						storage: z.literal('builtin')
					})
					.parse(JSON.parse(await file.readFile('utf8')));
			} finally {
				await file.close();
			}
		} catch {
			throw new UpdaterRefused('This Recoder backup is missing or invalid.');
		}
	}

	function appMount(docker: Inspection) {
		const mount = docker.Mounts.find((entry) => entry.Destination === DATA_PATH);
		const labels = docker.Config.Labels as Record<string, unknown> | null | undefined;

		if (
			labels?.[MANAGED_LABEL] !== 'true' ||
			!mount?.RW ||
			(mount.Type !== 'bind' && !mount.Name) ||
			docker.HostConfig.Privileged === true ||
			docker.HostConfig.PidMode === 'host' ||
			docker.HostConfig.IpcMode === 'host' ||
			docker.HostConfig.NetworkMode === 'host' ||
			(Array.isArray(docker.HostConfig.CapAdd) && docker.HostConfig.CapAdd.length > 0) ||
			(Array.isArray(docker.HostConfig.Devices) && docker.HostConfig.Devices.length > 0) ||
			docker.Mounts.some(
				(entry) =>
					!APP_MOUNTS.has(entry.Destination) ||
					[entry.Source, entry.Destination].some((path) => /(?:^|\/)docker\.sock$/.test(path))
			)
		)
			throw new UpdaterRefused('The Recoder container does not have a supported isolated data mount.');

		return mount;
	}

	function assertLineage(container: Inspection, original: string): void {
		if (
			container.Name !== `/${options.name}` &&
			container.Name !== `/${options.name}-previous-${original.slice(0, 12)}`
		)
			throw new UpdaterRefused('The saved container is outside the Recoder update lineage.');

		appMount(container);
	}

	async function offlineRestore(previous: Inspection, id: string): Promise<void> {
		await backup(id);

		const mount = appMount(previous);

		const name = `${options.name}-restore`;
		const orphan = await inspect(name, true);

		if (orphan) {
			const labels = orphan.Config.Labels as Record<string, unknown> | null | undefined;

			if (labels?.[HELPER_LABEL] !== 'true') throw new UpdaterRefused('The Recoder restore name is already in use.');

			await stop(orphan.Id);
			await remove(orphan.Id);
		}

		const helper = await create(name, {
			Image: previous.Image,
			Entrypoint: ['bun', 'apps/server/src/storage/backups/operator.ts'],
			Cmd: ['restore', '--archive', `${DATA_PATH}/backups/${id}/${archiveName}`, '--stopped'],
			WorkingDir: '/app',
			Env: [`RECODER_DATA_DIR=${DATA_PATH}`],
			Labels: { [HELPER_LABEL]: 'true' },
			Healthcheck: { Test: ['NONE'] },
			HostConfig: {
				NetworkMode: 'none',
				ReadonlyRootfs: true,
				CapDrop: ['ALL'],
				SecurityOpt: ['no-new-privileges'],
				Mounts: [{ Type: mount.Type, Source: mount.Name ?? mount.Source, Target: DATA_PATH, ReadOnly: false }]
			}
		});

		try {
			await start(helper);

			const response = await required(
				await send('POST', `/containers/${helper}/wait?condition=not-running`, undefined, 600_000),
				'Docker could not wait for the offline backup restore.'
			);

			const result = (await response.json()) as { StatusCode?: number };

			if (result.StatusCode !== 0) throw new UpdaterRefused('Recoder could not restore the selected backup.');
		} finally {
			await stop(helper).catch(() => {});
			await remove(helper).catch(() => {});
		}
	}

	async function switchContainer(original: string, image?: string, restore?: string): Promise<void> {
		const previous = (await inspect(original))!;

		assertLineage(previous, original);

		const { Env, Labels, User } = previous.Config;

		const { RestartPolicy, PortBindings, ReadonlyRootfs, Tmpfs, ShmSize, Memory, NanoCpus, PidsLimit } =
			previous.HostConfig;

		const networkMode = Object.entries(previous.NetworkSettings.Networks).find(([, network]) =>
			network.Aliases?.includes(options.name)
		)?.[0];

		if (!networkMode || ['host', 'none', 'bridge'].includes(networkMode))
			throw new UpdaterRefused('The Recoder container is not attached to the private updater network.');

		await stop(previous.Id);
		await rename(previous.Id, `${options.name}-previous-${previous.Id.slice(0, 12)}`);

		if (restore) await offlineRestore(previous, restore);

		const id = await create(options.name, {
			Image: image ?? previous.Image,
			Env,
			Labels,
			User,
			HostConfig: {
				NetworkMode: networkMode,
				RestartPolicy,
				PortBindings,
				ReadonlyRootfs,
				Tmpfs,
				ShmSize,
				Memory,
				NanoCpus,
				PidsLimit,
				CapDrop: ['ALL'],
				SecurityOpt: ['no-new-privileges'],
				Mounts: previous.Mounts.filter((mount) => mount.Type !== 'tmpfs').map((mount) => ({
					Type: mount.Type,
					Source: mount.Name ?? mount.Source,
					Target: mount.Destination,
					ReadOnly: !mount.RW
				}))
			},
			NetworkingConfig: {
				EndpointsConfig: Object.fromEntries(
					Object.entries(previous.NetworkSettings.Networks).map(([name, network]) => [
						name,
						{ Aliases: network.Aliases ?? [] }
					])
				)
			}
		});

		await start(id);
	}

	return {
		async current(): Promise<RunningContainer> {
			const docker = (await inspect())!;

			assertLineage(docker, docker.Id);

			const health = await readHealth(docker);

			if (!health) throw new UpdaterRefused('Recoder is not ready to update.');

			return { id: docker.Id, ...health };
		},
		backup,
		async pull(release) {
			const params = new URLSearchParams({ fromImage: release.platformImage, platform: release.platform });

			const response = await required(
				await send('POST', `/images/create?${params}`, undefined, 600_000),
				'Docker could not pull the verified image.'
			);

			const report = await response.text();

			for (const line of report.split('\n').filter(Boolean)) {
				const item = JSON.parse(line) as { error?: unknown; errorDetail?: unknown };

				if (item.error || item.errorDetail)
					throw new UpdaterRefused('Docker did not complete the verified image pull.');
			}

			const image = pulledImage.safeParse(
				await (
					await required(
						await send('GET', `/images/${encodeURIComponent(release.platformImage)}/json`),
						'Docker could not inspect the verified image.'
					)
				).json()
			);

			if (
				!image.success ||
				!image.data.RepoDigests.includes(release.platformImage) ||
				`${image.data.Os}/${image.data.Architecture}` !== release.platform
			)
				throw new UpdaterRefused('The pulled image does not match the signed digest for this platform.');
		},
		startCandidate: (original, release) => switchContainer(original, release.platformImage),
		startWithBackup: (original, id, release) => switchContainer(original, release?.platformImage, id),
		async recover(original, checkpoint) {
			const active = await inspect(options.name, true);
			const previous = (await inspect(original))!;

			assertLineage(previous, original);

			if (active && active.Id !== original) {
				assertLineage(active, active.Id);
				await stop(active.Id);
				await remove(active.Id);
			}

			await stop(original);
			await offlineRestore(previous, checkpoint);

			if (previous.Name !== `/${options.name}`) await rename(original, options.name);

			await start(original);
		},
		async healthy(version, dataVersion) {
			const deadline = Date.now() + 60_000;

			while (Date.now() < deadline) {
				const container = await inspect(options.name, true);
				const found = container && (await readHealth(container));

				if (found?.version === version && found.dataVersion === dataVersion) return true;

				await Bun.sleep(500);
			}

			return false;
		},
		async finish(original) {
			const previous = (await inspect(original))!;

			assertLineage(previous, original);
			if (previous.Name === `/${options.name}`) throw new UpdaterRefused('The active container cannot be removed.');

			await remove(original);
		}
	};
}
