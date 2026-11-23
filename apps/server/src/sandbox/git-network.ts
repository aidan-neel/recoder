/**
 * Network git commands are the part of a review that talks to the forge, so
 * they are the part that fails on a dropped connection. This module classifies
 * git's failures, retries the transient ones with backoff, and turns the wall
 * of progress output git prints mid-transfer into one readable cause.
 */

/** How long a git network command waits between retries, one entry per retry. */
export const RETRY_DELAYS_MS = [1_000, 3_000];

const PROGRESS_LINE =
	/^(?:remote: )?(?:Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Finding sources|Updating files):/;

/** A failure that reads as a network drop between here and the forge, worth a retry. */
const TRANSIENT =
	/early EOF|RPC failed|the remote end hung up|connection reset by peer|could not resolve host|connection refused|transfer closed|timed? ?out|SSL routines|SSL_ERROR/i;

/** A failure no retry can fix: the forge refused the credentials or the repository is not there. */
const PERMANENT =
	/Authentication failed|could not read Username|Permission denied|invalid credentials|Repository not found|terminal prompts disabled/i;

/** How a known failure reads to a person, matched against the command's whole output. */
const CAUSES: [RegExp, string][] = [
	[/early EOF/, 'the connection dropped mid-transfer'],
	[/transfer closed/, 'the connection dropped mid-transfer'],
	[/the remote end hung up/, 'the remote hung up mid-transfer'],
	[/connection reset by peer/, 'the connection was reset'],
	[/RPC failed/, 'the request to the remote failed'],
	[/could not resolve host/, 'the remote host could not be resolved'],
	[/connection refused/, 'the connection was refused'],
	[/timed? ?out/i, 'the connection timed out'],
	[/SSL routines|SSL_ERROR/, 'the secure connection failed']
];

/** Whether a failed git command would succeed on a retry: a drop, not a refusal. */
export function isTransientGitFailure(logs: string): boolean {
	return !PERMANENT.test(logs) && TRANSIENT.test(logs);
}

/** The last `fatal:` or `error:` line, or whatever other line git left behind, with progress lines stripped. */
function causeLine(logs: string): string | null {
	const lines = logs
		.split(/\r\n|\r|\n/)
		.map((line) => line.trim())
		.filter((line) => line && !PROGRESS_LINE.test(line));

	return [...lines].reverse().find((line) => /^(?:fatal|error):/.test(line)) ?? lines.at(-1) ?? null;
}

/** How much of the transfer had landed when it dropped, read from the last progress line. */
function receivedBytes(logs: string): string | null {
	const match = [...logs.matchAll(/Receiving objects.*?([\d.]+) (KiB|MiB|GiB)/g)].at(-1);

	if (!match) return null;

	return `${Math.round(Number(match[1]))} ${match[2]!.replace('i', '')}`;
}

/**
 * One readable cause for a failed git command: the progress lines are stripped
 * and the failure is named the way a person would, with the amount transferred
 * when the connection dropped. `the connection dropped after 509 MB (early EOF)`.
 */
export function summarizeGitFailure(logs: string): string {
	const detail = causeLine(logs)?.replace(/^(?:fatal|error):\s*/, '') ?? 'git exited with an error';
	const cause = CAUSES.find(([pattern]) => pattern.test(logs));

	if (!cause) return detail;

	const bytes = receivedBytes(logs);

	return `${cause[1]}${bytes ? ` after ${bytes}` : ''} (${detail})`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs one git network command, retrying after each delay in `delays` when it
 * fails on a dropped connection. git resumes a fetch from the objects it
 * already received; a clone starts over. The last failure is rethrown, telling
 * how many times the command ran.
 */
export async function retryTransientGit(
	work: () => Promise<string>,
	delays: number[],
	wait: (ms: number) => Promise<void> = sleep
): Promise<string> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await work();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (attempt >= delays.length || !isTransientGitFailure(message)) {
				if (!attempt) throw error;

				throw new Error(`${message} Tried ${attempt + 1} times.`, { cause: error });
			}

			await wait(delays[attempt]!);
		}
	}
}
