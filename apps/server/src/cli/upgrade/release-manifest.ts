import { writeFile } from 'node:fs/promises';
import { DATA_VERSION, OLDEST_DATA_VERSION } from '../../storage/data-version.js';
import { CliError, EXIT, describeError } from '../exit.js';
import { isReleaseTag, type ReleaseTag, versionOfTag } from './release-tag.js';

/**
 * The oldest running version allowed to update in place to this release: every release's data the oldest
 * release could have written is still readable, so all of them may update until a release narrows this.
 * Release policy, edited when a release stops supporting an old install.
 */
export const MIN_UPDATABLE_VERSION = '0.1.0';

/** The manifest's own version, so the updater can ignore what a newer release adds. */
export const RELEASE_SCHEMA_VERSION = 1;

/** How the release presents itself: `stable` unless the tag carries a pre-release name (`v0.3.0-beta.1`). */
export type ReleaseChannel = 'stable' | 'beta';

/** The wire format the container updater reads: what this release is, where its image is, and what it moves. */
export interface ReleaseManifest {
	schemaVersion: typeof RELEASE_SCHEMA_VERSION;
	version: string;
	channel: ReleaseChannel;
	releasedAt: string;
	image: string;
	/** The multi-arch index the release's cosign signature is attached to. */
	indexDigest: string;
	/** One immutable manifest digest per platform, the one the updater pulls. */
	platforms: Record<string, string>;
	/** The schema this release writes; the updater checks it against the running data before it switches. */
	dataVersion: number;
	/** The oldest schema this release reads; a rollback restore decides from it what an older image needs. */
	minDataVersion: number;
	/** The oldest running version that may update in place to this release. */
	minVersion: string;
	/** The release notes, as Markdown. */
	notes: string;
}

/** A release manifest's input, checked here so the updater never reasons about a malformed one. */
export interface ReleaseManifestInput {
	tag: ReleaseTag;
	image: string;
	indexDigest: string;
	platforms: Record<string, string>;
	notes: string;
	releasedAt: string;
}

/** Whether a platform entry names a container platform the image build could have produced. */
const PLATFORM = /^linux\/(?:amd64|arm64)$/;

/** Whether a digest is an immutable OCI manifest digest: a sha256 and nothing but its hex. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * Builds the release manifest from the release workflow's facts: the tag's version and channel, the digests
 * the image push answered with, and the data versions this release declares in source. Throws, with the field
 * named, on input the updater would refuse to trust.
 */
export function buildReleaseManifest(input: ReleaseManifestInput): ReleaseManifest {
	if (!isReleaseTag(input.tag)) throw new CliError(`"${input.tag}" is not a release tag.`, EXIT.failed);

	if (input.image.length === 0 || /\s/.test(input.image)) throw new CliError('The image name is missing.', EXIT.failed);

	if (!DIGEST.test(input.indexDigest))
		throw new CliError('The index digest is not an immutable sha256 digest.', EXIT.failed);

	const platforms: Record<string, string> = {};

	for (const [platform, digest] of Object.entries(input.platforms)) {
		if (!PLATFORM.test(platform) || !DIGEST.test(digest)) {
			throw new CliError(`The image build answered a digest "${platform}" cannot carry (${digest}).`, EXIT.failed);
		}

		platforms[platform] = digest;
	}

	if (Object.keys(platforms).length === 0)
		throw new CliError('The image build answered no platform digests.', EXIT.failed);

	if (input.releasedAt.length === 0 || Number.isNaN(Date.parse(input.releasedAt))) {
		throw new CliError('The release time is not a date.', EXIT.failed);
	}

	const tag = input.tag;

	return {
		schemaVersion: RELEASE_SCHEMA_VERSION,
		version: versionOfTag(tag),
		channel: /-[0-9A-Za-z.]+$/.test(tag) ? 'beta' : 'stable',
		releasedAt: new Date(input.releasedAt).toISOString(),
		image: input.image,
		indexDigest: input.indexDigest,
		platforms,
		dataVersion: DATA_VERSION,
		minDataVersion: OLDEST_DATA_VERSION,
		minVersion: MIN_UPDATABLE_VERSION,
		notes: input.notes
	};
}

/**
 * Parses the per-platform digests the release workflow passes in `RELEASE_PLATFORMS`: one JSON object of
 * platform name to manifest digest, read from the pushed image's index. Throws, naming the variable, on
 * input the manifest builder would otherwise reach as a broken JSON parse.
 */
export function parsePlatforms(raw: string): Record<string, string> {
	if (raw.length === 0)
		throw new CliError(
			"RELEASE_PLATFORMS is empty: the workflow did not read the pushed image's per-platform digests.",
			EXIT.failed
		);

	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CliError('RELEASE_PLATFORMS is not a JSON object of platform digests.', EXIT.failed);
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new CliError('RELEASE_PLATFORMS is not a JSON object of platform digests.', EXIT.failed);
	}

	return parsed as Record<string, string>;
}

/** The environment variables the release workflow sets: the tag, the pushed image's digests, and the release. */
function inputFromEnv(): ReleaseManifestInput {
	const tag = process.env.RELEASE_TAG ?? '';

	return {
		tag: isReleaseTag(tag) ? tag : (tag as ReleaseTag),
		image: process.env.RELEASE_IMAGE ?? '',
		indexDigest: process.env.RELEASE_INDEX_DIGEST ?? '',
		platforms: parsePlatforms(process.env.RELEASE_PLATFORMS ?? ''),
		notes: '',
		releasedAt: process.env.RELEASED_AT ?? ''
	};
}

/**
 * Writes the release manifest the workflow attaches to its release: the release body from
 * `RELEASE_NOTES_FILE` and the rest from the environment, checked and written as one JSON object.
 */
async function main(): Promise<void> {
	const notesFile = process.env.RELEASE_NOTES_FILE;

	if (!notesFile)
		throw new CliError('RELEASE_NOTES_FILE names the release body to copy into the manifest.', EXIT.failed);

	const input = { ...inputFromEnv(), notes: await Bun.file(notesFile).text() };
	const manifest = buildReleaseManifest(input);

	await writeFile(process.env.RELEASE_OUT ?? 'release.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(describeError(error));
		process.exit(error instanceof CliError ? error.exitCode : EXIT.failed);
	}
}
