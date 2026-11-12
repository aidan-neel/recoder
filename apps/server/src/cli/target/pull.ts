import { randomUUID } from 'node:crypto';
import type { PullRequest, Repo } from '@recoder/shared';
import { GhError } from '../../forge/cli.js';
import { locateRepo, refspecFor } from '../../forge/providers.js';
import { fetchPull } from '../../forge/pull-preview.js';
import { tokenEnv } from '../../forge/tokens.js';
import { prepareSandbox, sandboxLocation, sandboxRevision } from '../../sandbox/sandbox.js';
import { CliError, describeError, notReadyError, usageError } from '../exit.js';
import type { PullStart } from '../review/options.js';
import { checkedOutTarget, removedOnFailure } from './checked-out.js';
import { startPullRevision } from './start-point.js';
import { assertNotCancelled, gitOutput } from './git.js';
import { redactedTail, withoutCredentials } from '../../util/redact.js';
import type { ResolvedTarget, TargetRequest } from './resolve-target.js';

/**
 * Pull request addresses the forges print: GitHub's `/pull/N`, GitLab's
 * `/-/merge_requests/N`, and the local forge's `file:` URL with `#pull/N`.
 */
const PULL_URL_PATTERNS = [
	/^(?<repo>https?:\/\/[^?#]+?)\/pull\/(?<number>\d+)(?:[/?#].*)?$/,
	/^(?<repo>https?:\/\/[^?#]+?)\/-\/merge_requests\/(?<number>\d+)(?:[/?#].*)?$/,
	/^(?<repo>file:\/\/[^#]+)#pull\/(?<number>\d+)$/
];

/**
 * What a pull target takes; a rejected value is never quoted back, since it
 * may hold a secret anywhere. The flag is not named: the argument parser owns
 * its spelling.
 */
const PULL_EXPECTED = 'A pull request is given as its number, or as a GitHub or GitLab pull request URL.';

/**
 * Why the forge could not answer, by the kind of its error. The forge's own
 * text is never shown: it can quote the remote URL, query string included.
 */
const FORGE_FAILURES: Record<GhError['kind'], string> = {
	unavailable: 'the forge CLI (gh or glab) could not be run',
	auth: 'the forge CLI (gh or glab) is not signed in',
	'not-found': 'the forge has no such pull request',
	'rate-limit': 'the forge rate limit was reached',
	unknown: 'the forge could not be read'
};

/** A repository as the forge functions read it. */
type ForgeRepo = Pick<Repo, 'url' | 'provider'>;

/** Which pull request, on which repository. */
interface PullAddress {
	repoUrl: string;
	number: number;
}

/** The pull request a checkout step works on, the credentials git was given, and what stops it. */
interface PullCheckout {
	address: PullAddress;
	credentials: Record<string, string>;
	signal: AbortSignal;
}

/**
 * A pull or merge request checked out the way the server checks one out:
 * metadata from the forge, the head fetched into a fresh checkout, and the
 * base branch fetched to find the merge base. `start` says where the review
 * begins: the whole change, after a commit the caller named, or after the
 * head of the last review that counts.
 */
export async function resolvePull(request: TargetRequest, pull: string, start: PullStart): Promise<ResolvedTarget> {
	const address = await pullAddress(request, pull);
	const repo = forgeRepo(address.repoUrl);
	const pr = await pullMetadata(repo, address.number);
	const { slug } = locateRepo(repo.url);
	const reviewId = randomUUID();
	const { path } = sandboxLocation(slug, address.number, reviewId);
	const headName = pr.headRef || `#${address.number}`;

	assertNotCancelled(request.signal);

	return removedOnFailure(path, async () => {
		const credentials = tokenEnv(repo.provider, repo.url);
		const { fetchRef, branch } = refspecFor(repo.provider, address.number);
		const checkout = { address, credentials, signal: request.signal };
		const remote = { overrides: credentials, provider: repo.provider, signal: request.signal };

		await checkoutStep(checkout, 'fetching its head', () =>
			prepareSandbox({
				repoSlug: slug,
				prNumber: address.number,
				repoUrl: repo.url,
				fetchRef,
				branch,
				reviewId,
				provider: repo.provider,
				env: credentials,
				expectedHeadSha: pr.headSha,
				signal: request.signal
			})
		);

		const branchRevision = await checkoutStep(checkout, `fetching its base branch ${pr.base}`, () =>
			sandboxRevision(path, pr.base, remote)
		);

		const applied = await startPullRevision({ revision: branchRevision, start, signal: request.signal, headName });

		return checkedOutTarget({
			request,
			revision: applied.revision,
			headName,
			pull: { title: pr.title, body: pr.body ?? null, url: pr.url },
			start: applied.start
		});
	});
}

async function pullAddress(request: TargetRequest, pull: string): Promise<PullAddress> {
	if (/^\d+$/.test(pull)) return { repoUrl: await originUrl(request), number: pullNumber(pull) };

	for (const pattern of PULL_URL_PATTERNS) {
		const groups = pattern.exec(pull)?.groups;

		if (groups?.repo && groups.number) {
			return { repoUrl: withoutCredentials(groups.repo), number: pullNumber(groups.number) };
		}
	}

	throw usageError(PULL_EXPECTED);
}

function pullNumber(text: string): number {
	const number = Number(text);

	if (!Number.isSafeInteger(number) || number < 1) {
		throw usageError(`${PULL_EXPECTED} A pull request number is 1 or more.`);
	}

	return number;
}

/** The `origin` remote of the user's repository, which names the forge a bare pull number belongs to. */
async function originUrl(request: TargetRequest): Promise<string> {
	try {
		return forgeAddress(
			await gitOutput({ cwd: request.repoPath, signal: request.signal }, ['remote', 'get-url', 'origin'])
		);
	} catch (err) {
		if (!(err instanceof CliError)) throw err;
		assertNotCancelled(request.signal);
		throw notReadyError(`${err.message}. A pull request number needs an origin remote; pass the pull request URL.`);
	}
}

/**
 * A remote URL as the forge functions get it. An http(s) URL keeps only its
 * scheme, host and path: git never needs the rest, and a query string reaching
 * a forge CLI's arguments would be written to the command log. Any other form
 * (`ssh://git@host/path`) keeps its user name, which ssh needs.
 */
function forgeAddress(url: string): string {
	return /^https?:\/\//i.test(url) ? shownRemote(withoutCredentials(url)) : withoutCredentials(url);
}

/**
 * A remote URL as a message may show it: scheme, host and path only. One that
 * does not parse as a URL (`git@host:path`, or a password holding a `/`) is
 * not shown at all, because no reliable part of it can be cut out.
 */
function shownRemote(url: string): string {
	if (!URL.canParse(url)) return 'the repository';

	const { protocol, host, pathname } = new URL(url);

	return `${protocol}//${host}${pathname}`;
}

/** The repository as the forge functions take it: its address and which forge serves it. */
function forgeRepo(repoUrl: string): ForgeRepo {
	try {
		return { url: repoUrl, provider: locateRepo(repoUrl).provider };
	} catch {
		throw notReadyError(`${shownRemote(repoUrl)} is not a GitHub, GitLab or local forge repository.`);
	}
}

async function pullMetadata(repo: ForgeRepo, number: number): Promise<PullRequest> {
	const pr = await fetchPull(repo, number, { metadataOnly: true }).then(
		(fetched) => fetched.pr,
		(err: unknown) => {
			const reason = err instanceof GhError ? FORGE_FAILURES[err.kind] : FORGE_FAILURES.unknown;

			throw notReadyError(`Could not read pull request ${number} from ${shownRemote(repo.url)}: ${reason}.`);
		}
	);

	if (!pr.base) throw notReadyError(`The forge did not name the base branch of pull request ${number}.`);

	return pr;
}

/**
 * Runs a checkout step. A failure names the pull request and the step, and
 * shows the last lines of git's error with every credential removed.
 */
async function checkoutStep<T>(pull: PullCheckout, stepName: string, step: () => Promise<T>): Promise<T> {
	try {
		return await step();
	} catch (err) {
		assertNotCancelled(pull.signal);
		if (err instanceof CliError) throw err;

		const { number, repoUrl } = pull.address;
		const failed = `Could not check out pull request ${number} from ${shownRemote(repoUrl)}: ${stepName} failed.`;

		throw notReadyError(`${failed} git said: ${gitErrorTail(err, pull.credentials)}`);
	}
}

/**
 * The last lines of git's error, redacted. The tokens git was given are
 * removed by value, so one quoted in any form never shows; the other values
 * (`GITLAB_HOST`) are not secret.
 */
function gitErrorTail(err: unknown, credentials: Record<string, string>): string {
	const secrets = Object.entries(credentials)
		.filter(([name]) => name.endsWith('_TOKEN'))
		.map(([, value]) => value);

	return redactedTail(describeError(err), secrets);
}
