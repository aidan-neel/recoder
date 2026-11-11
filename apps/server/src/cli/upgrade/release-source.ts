import { CliError, EXIT, describeError, usageError } from '../exit.js';
import { isReleaseTag, type ReleaseTag } from './release-tag.js';

const RELEASES = 'https://github.com/aidan-neel/recoder/releases';

/** How long GitHub may take to say which release is the latest, or to send the checksums. */
const LOOKUP_TIMEOUT_MS = 30_000;

/** How long a binary of some 100 MB may take to arrive on a slow line. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const NOT_FOUND = 404;

/** Where releases come from; injected so a test needs no network. */
export interface ReleaseSource {
	/** The tag of the latest release. */
	latestTag(signal: AbortSignal): Promise<ReleaseTag>;
	/** The text of a release's `SHA256SUMS`. */
	checksums(tag: ReleaseTag, signal: AbortSignal): Promise<string>;
	/** One of a release's binaries, by its file name. */
	binary(tag: ReleaseTag, asset: string, signal: AbortSignal): Promise<Uint8Array>;
}

/** What a request to GitHub is for and how long it may take. */
interface ReleaseRequest {
	url: string;
	/** What the request fetches, for the error of one that fails. */
	what: string;
	timeoutMs: number;
	signal: AbortSignal;
	redirect?: 'manual';
}

/**
 * The releases on GitHub, read with no token, as the install script reads them. The latest release is read from
 * where its page redirects to, which the API's rate limit does not count. `request` is `fetch`.
 */
export function githubReleases(request: typeof fetch): ReleaseSource {
	return {
		latestTag: async (signal) => {
			const response = await send(request, {
				url: `${RELEASES}/latest`,
				what: 'the latest release',
				timeoutMs: LOOKUP_TIMEOUT_MS,
				signal,
				redirect: 'manual'
			});

			return tagOfLocation(response.headers.get('location'));
		},
		checksums: async (tag, signal) => {
			const what = `the checksums of ${tag}`;
			const url = `${RELEASES}/download/${tag}/SHA256SUMS`;
			const response = await send(request, { url, what, timeoutMs: LOOKUP_TIMEOUT_MS, signal });

			return (await requireFound(response, tag, what)).text();
		},
		binary: async (tag, asset, signal) => {
			const what = `${asset} of ${tag}`;
			const url = `${RELEASES}/download/${tag}/${asset}`;
			const response = await send(request, { url, what, timeoutMs: DOWNLOAD_TIMEOUT_MS, signal });

			return new Uint8Array(await (await requireFound(response, tag, what)).arrayBuffer());
		}
	};
}

/** Sends the request under its timeout and the caller's stop. A request that never gets an answer fails by name. */
async function send(
	request: typeof fetch,
	{ url, what, timeoutMs, signal, redirect }: ReleaseRequest
): Promise<Response> {
	try {
		return await request(url, { redirect, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
	} catch (error) {
		if (signal.aborted) throw new CliError('The upgrade was cancelled.', EXIT.cancelled);

		throw new CliError(`cannot download ${what} from GitHub: ${describeError(error)}`, EXIT.failed);
	}
}

/** The response when it holds the file. A release that does not exist is the caller's mistake; anything else failed. */
async function requireFound(response: Response, tag: ReleaseTag, what: string): Promise<Response> {
	if (response.ok) return response;

	if (response.status === NOT_FOUND) throw usageError(`there is no release ${tag}, or it has no ${what}.`);

	throw new CliError(`cannot download ${what}: GitHub answered ${response.status}.`, EXIT.failed);
}

/** The tag a release page's address ends with. GitHub's answer is outside input, so it must have a tag's shape. */
function tagOfLocation(location: string | null): ReleaseTag {
	const tag = location?.split('/').pop() ?? '';

	if (!isReleaseTag(tag)) {
		throw new CliError('cannot tell which release is the latest: GitHub named none.', EXIT.failed);
	}

	return tag;
}
