import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { githubReleases } from '../../../src/cli/upgrade/release-source';
import { parseReleaseTag } from '../../../src/cli/upgrade/release-tag';

const TAG = parseReleaseTag('v0.2.0');

const NEVER_STOPPED = new AbortController().signal;

/** Releases whose every request gets `answer`, and the addresses that were asked for. */
function releasesAnswering(answer: () => Response | Promise<Response>) {
	const asked: string[] = [];

	const request = async (url: string | URL | Request): Promise<Response> => {
		asked.push(String(url));

		return answer();
	};

	return { asked, releases: githubReleases(request as typeof fetch) };
}

const redirectTo = (location: string): Response => new Response(null, { status: 302, headers: { location } });

test('the latest release is the tag its page redirects to', async () => {
	const { releases } = releasesAnswering(() => redirectTo('https://github.com/aidan-neel/recoder/releases/tag/v0.3.1'));

	expect(await releases.latestTag(NEVER_STOPPED)).toBe(parseReleaseTag('v0.3.1'));
});

test.each(['https://github.com/login', 'https://github.com/aidan-neel/recoder/releases/tag/../../evil', ''])(
	'a redirect to %s names no release and fails, so nothing is downloaded from it',
	async (location) => {
		const { releases } = releasesAnswering(() => redirectTo(location));

		await expect(releases.latestTag(NEVER_STOPPED)).rejects.toMatchObject({ exitCode: EXIT.failed });
	}
);

test('a binary is downloaded from the release it was asked of', async () => {
	const { asked, releases } = releasesAnswering(() => new Response(new Uint8Array([1, 2, 3])));

	expect(await releases.binary(TAG, 'recoder-linux-x64', NEVER_STOPPED)).toEqual(new Uint8Array([1, 2, 3]));
	expect(asked).toEqual(['https://github.com/aidan-neel/recoder/releases/download/v0.2.0/recoder-linux-x64']);
});

test('a release that does not exist is a usage error, and any other answer a failure', async () => {
	const missing = releasesAnswering(() => new Response('', { status: 404 })).releases;
	const broken = releasesAnswering(() => new Response('', { status: 503 })).releases;

	await expect(missing.checksums(TAG, NEVER_STOPPED)).rejects.toMatchObject({ exitCode: EXIT.usage });
	await expect(broken.checksums(TAG, NEVER_STOPPED)).rejects.toMatchObject({ exitCode: EXIT.failed });
});

test('a request that cannot reach GitHub fails with what it was fetching, and a stopped one is cancelled', async () => {
	const offline = releasesAnswering(() => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com'))).releases;
	const stopped = AbortSignal.abort();

	await expect(offline.latestTag(NEVER_STOPPED)).rejects.toMatchObject({
		exitCode: EXIT.failed,
		message: expect.stringContaining('the latest release')
	});

	await expect(offline.latestTag(stopped)).rejects.toMatchObject({ exitCode: EXIT.cancelled });
});
