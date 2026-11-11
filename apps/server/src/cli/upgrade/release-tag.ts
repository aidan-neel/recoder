import { usageError } from '../exit.js';

/**
 * The one shape a release tag may have: `v`, three numbers, and an optional pre-release name. A tag from the command
 * line or from GitHub's answer becomes part of a download address, so nothing else is ever accepted.
 */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?$/;

declare const releaseTagBrand: unique symbol;

/** A string checked against `RELEASE_TAG`, such as `v0.2.0`. */
export type ReleaseTag = string & { readonly [releaseTagBrand]: true };

export function isReleaseTag(value: string): value is ReleaseTag {
	return RELEASE_TAG.test(value);
}

/** The tag a caller named, with or without its `v`; anything that is not one is a usage error naming it. */
export function parseReleaseTag(value: string): ReleaseTag {
	const tag = value.startsWith('v') ? value : `v${value}`;

	if (!isReleaseTag(tag)) throw usageError(`"${value}" is not a release; releases look like v0.2.0.`);

	return tag;
}

/** The version a release's binary prints for `--version`: the tag without its `v`. */
export function versionOfTag(tag: ReleaseTag): string {
	return tag.slice(1);
}

/**
 * Whether the release is newer than the version running: a higher number, or the same numbers once the running
 * version is a pre-release of them. A running version that is not a release number is older than any release.
 */
export function isNewerRelease(tag: ReleaseTag, runningVersion: string): boolean {
	const release = RELEASE_TAG.exec(tag);
	const running = RELEASE_TAG.exec(`v${runningVersion}`);

	if (release === null || running === null) return release !== null;

	for (const part of [1, 2, 3]) {
		const difference = Number(release[part]) - Number(running[part]);

		if (difference !== 0) return difference > 0;
	}

	return release[4] === undefined && running[4] !== undefined;
}
