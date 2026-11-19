import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { isReleaseTag, type ReleaseTag } from '../../cli/upgrade/release-tag';
import { UpdaterRefused } from './protocol';
import type { ReleaseData } from './compatibility';

const PROJECT = 'aidan-neel/recoder';
const DOWNLOADS = `https://github.com/${PROJECT}/releases/download`;
const IMAGE = `ghcr.io/${PROJECT}`;
const ISSUER = 'https://token.actions.githubusercontent.com';
const MAX_ASSET_BYTES = 512 * 1024;
const RELEASE_PAGES = `https://api.github.com/repos/${PROJECT}/releases?per_page=30`;
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const version = z
	.string()
	.max(100)
	.refine((value) => isReleaseTag(`v${value}`));

const manifestSchema = z.object({
	schemaVersion: z.literal(1),
	version,
	channel: z.enum(['stable', 'beta']),
	releasedAt: z.iso.datetime({ offset: true }),
	image: z.literal(IMAGE),
	indexDigest: digest,
	platforms: z.record(z.string(), digest),
	dataVersion: z.number().int().nonnegative(),
	minDataVersion: z.number().int().nonnegative(),
	minVersion: version,
	notes: z.string().max(100_000)
});

export interface ContainerRelease extends ReleaseData {
	version: string;
	channel: 'stable' | 'beta';
	releasedAt: string;
	notes: string;
	minVersion: string;
	image: string;
	platform: string;
	platformImage: string;
}

type Verify = (argv: string[]) => Promise<boolean>;

async function cosign(args: string[]): Promise<boolean> {
	const binary = Bun.which('cosign');

	if (!binary) throw new UpdaterRefused('The updater cannot verify releases: cosign is not installed.');

	const child = Bun.spawn([binary, ...args], {
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore',
		signal: AbortSignal.timeout(60_000)
	});

	return (await child.exited) === 0;
}

async function boundedBody(response: Response): Promise<Uint8Array> {
	if (!response.body) throw new UpdaterRefused('The release listing is empty.');

	const reader = response.body.getReader();
	const buffer = new Uint8Array(MAX_ASSET_BYTES);
	let position = 0;

	try {
		for (;;) {
			const next = await reader.read();

			if (next.done) return buffer.subarray(0, position);
			if (position + next.value.length > buffer.length) throw new UpdaterRefused('The release listing is too large.');
			buffer.set(next.value, position);
			position += next.value.length;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}

async function remote(request: typeof fetch, url: string): Promise<Uint8Array> {
	const response = await request(url, {
		headers: { Accept: 'application/json, application/octet-stream', 'User-Agent': 'recoder-updater' },
		signal: AbortSignal.timeout(15_000)
	});

	if (!response.ok) throw new UpdaterRefused('This version is not listed in a published Recoder release.');

	return boundedBody(response);
}

function decode(payload: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
	} catch {
		throw new UpdaterRefused('The published release data is invalid.');
	}
}

function identity(tag: ReleaseTag): string[] {
	return [
		'--certificate-oidc-issuer',
		ISSUER,
		'--certificate-identity',
		`https://github.com/${PROJECT}/.github/workflows/release.yml@refs/tags/${tag}`
	];
}

export function releaseSource(platform: string, request: typeof fetch = fetch, verify: Verify = cosign) {
	async function manifest(version: string): Promise<ContainerRelease> {
		const tag = `v${version}`;

		if (!isReleaseTag(tag) || tag.length > 101) throw new UpdaterRefused('Use an exact published Recoder version.');

		const url = `${DOWNLOADS}/${tag}/release.json`;
		const [payload, bundle] = await Promise.all([remote(request, url), remote(request, `${url}.sig`)]);
		const directory = await mkdtemp(join(tmpdir(), 'recoder-release-'));

		try {
			const manifestFile = join(directory, 'release.json');
			const bundleFile = join(directory, 'release.json.sig');

			await Promise.all([
				writeFile(manifestFile, payload, { mode: 0o600, flag: 'wx' }),
				writeFile(bundleFile, bundle, { mode: 0o600, flag: 'wx' })
			]);

			if (!(await verify(['verify-blob', '--bundle', bundleFile, ...identity(tag), manifestFile])))
				throw new UpdaterRefused('The release manifest is not signed by the Recoder release workflow.');

			const parsed = manifestSchema.safeParse(decode(payload));

			if (
				!parsed.success ||
				parsed.data.version !== version ||
				parsed.data.minDataVersion > parsed.data.dataVersion ||
				!Object.hasOwn(parsed.data.platforms, platform)
			)
				throw new UpdaterRefused('The signed release manifest does not list this version and platform.');

			const release = parsed.data;

			return {
				version,
				channel: release.channel,
				releasedAt: release.releasedAt,
				notes: release.notes,
				minVersion: release.minVersion,
				dataVersion: release.dataVersion,
				oldestDataVersion: release.minDataVersion,
				platform,
				image: `${release.image}@${release.indexDigest}`,
				platformImage: `${release.image}@${release.platforms[platform]}`
			};
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}

	async function latest(): Promise<Partial<Record<ContainerRelease['channel'], ContainerRelease>>> {
		const releases = z.array(z.object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean() }));
		const parsed = releases.safeParse(decode(await remote(request, RELEASE_PAGES)));

		if (!parsed.success) throw new UpdaterRefused('The published release listing is invalid.');

		const candidates = parsed.data.filter((release) => !release.draft && isReleaseTag(release.tag_name));
		const channels = ['stable', 'beta'] as const;

		const results = await Promise.all(
			channels.map(async (channel) => {
				const release = candidates.find((candidate) => candidate.prerelease === (channel === 'beta'));

				if (!release) return;

				const found = await manifest(release.tag_name.slice(1)).catch(() => undefined);

				return found?.channel === channel ? found : undefined;
			})
		);

		return Object.fromEntries(results.flatMap((result) => (result ? [[result.channel, result]] : [])));
	}

	async function authorize(version: string): Promise<ContainerRelease> {
		const release = await manifest(version);
		const tag = `v${version}` as ReleaseTag;

		if (!(await verify(['verify', ...identity(tag), release.image])))
			throw new UpdaterRefused('The listed image is not signed by the Recoder release workflow.');

		return release;
	}

	return { latest, authorize };
}
