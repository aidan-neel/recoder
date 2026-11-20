import { describe, expect, test } from 'bun:test';
import {
	buildReleaseManifest,
	parsePlatforms,
	RELEASE_SCHEMA_VERSION,
	type ReleaseManifestInput
} from '../../../src/cli/upgrade/release-manifest';
import { parseReleaseTag } from '../../../src/cli/upgrade/release-tag';
import { DATA_VERSION, OLDEST_DATA_VERSION } from '../../../src/storage/data-version';

const INDEX = `sha256:${'a'.repeat(64)}`;
const AMD64 = `sha256:${'b'.repeat(64)}`;
const ARM64 = `sha256:${'c'.repeat(64)}`;

const input: ReleaseManifestInput = {
	tag: parseReleaseTag('v0.3.0'),
	image: 'ghcr.io/aidan-neel/recoder',
	indexDigest: INDEX,
	platforms: { 'linux/amd64': AMD64, 'linux/arm64': ARM64 },
	notes: '## What changed',
	releasedAt: '2026-11-20T18:00:00Z'
};

describe('buildReleaseManifest', () => {
	test('carries the version, digests and data versions the updater needs', () => {
		expect(buildReleaseManifest(input)).toEqual({
			schemaVersion: RELEASE_SCHEMA_VERSION,
			version: '0.3.0',
			channel: 'stable',
			releasedAt: '2026-11-20T18:00:00.000Z',
			image: 'ghcr.io/aidan-neel/recoder',
			indexDigest: INDEX,
			platforms: { 'linux/amd64': AMD64, 'linux/arm64': ARM64 },
			dataVersion: DATA_VERSION,
			minDataVersion: OLDEST_DATA_VERSION,
			minVersion: '0.1.0',
			notes: '## What changed'
		});
	});

	test('a pre-release tag publishes on the beta channel', () => {
		expect(buildReleaseManifest({ ...input, tag: parseReleaseTag('v0.4.0-beta.1') }).channel).toBe('beta');
	});

	test('a digest that is not an immutable sha256 is refused', () => {
		expect(() => buildReleaseManifest({ ...input, indexDigest: 'sha256:abc' })).toThrow('index digest');
		expect(() => buildReleaseManifest({ ...input, indexDigest: '0.3.0' })).toThrow('index digest');
	});

	test('a platform digest outside the image build is refused', () => {
		expect(() => buildReleaseManifest({ ...input, platforms: { 'linux/riscv64': AMD64 } })).toThrow('cannot carry');

		expect(() => buildReleaseManifest({ ...input, platforms: { 'linux/amd64': 'sha256:abc' } })).toThrow(
			'cannot carry'
		);
	});

	test('an image build that answered no platform digests is refused', () => {
		expect(() => buildReleaseManifest({ ...input, platforms: {} })).toThrow('no platform digests');
	});
});

describe('parsePlatforms', () => {
	test('the empty RELEASE_PLATFORMS the workflow can hand over names the variable', () => {
		expect(() => parsePlatforms('')).toThrow('RELEASE_PLATFORMS is empty');
	});

	test('malformed or non-object RELEASE_PLATFORMS names the variable', () => {
		expect(() => parsePlatforms('{"linux/amd64"')).toThrow('RELEASE_PLATFORMS is not');
		expect(() => parsePlatforms('["linux/amd64"]')).toThrow('RELEASE_PLATFORMS is not');
		expect(() => parsePlatforms('null')).toThrow('RELEASE_PLATFORMS is not');
	});

	test("the digests step's JSON object parses as-is", () => {
		expect(parsePlatforms(JSON.stringify({ 'linux/amd64': AMD64, 'linux/arm64': ARM64 }))).toEqual({
			'linux/amd64': AMD64,
			'linux/arm64': ARM64
		});
	});
});
