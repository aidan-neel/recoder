import { expect, test } from 'bun:test';
import {
	RETRY_DELAYS_MS,
	isTransientGitFailure,
	retryTransientGit,
	summarizeGitFailure
} from '../../src/sandbox/git-network';

test('a clone that drops mid-transfer is summarized with the dropped bytes and no progress', () => {
	const summary = summarizeGitFailure(
		[
			'Receiving objects: 30% (205016/668773), 422.71 MiB | 3.65 MiB/s',
			'Receiving objects: 36% (243804/668773), 509.13 MiB | 3.50 MiB/s',
			'fatal: early EOF'
		].join('\r')
	);

	expect(summary).toBe('the connection dropped mid-transfer after 509 MB (early EOF)');
	expect(summary).not.toContain('Receiving objects');
});

test('a drop without a byte count keeps the cause alone', () => {
	expect(summarizeGitFailure('fatal: early EOF')).toBe('the connection dropped mid-transfer (early EOF)');
});

test("a refusal is reported with git's own fatal line, progress stripped", () => {
	const summary = summarizeGitFailure(
		[
			'Receiving objects: 5% (33438/668773), 62.00 MiB | 1.00 MiB/s',
			"fatal: Authentication failed for 'https://github.com/o/r.git'"
		].join('\r')
	);

	expect(summary).toBe("Authentication failed for 'https://github.com/o/r.git'");
});

test("an unknown failure falls back to git's last non-progress line", () => {
	expect(summarizeGitFailure('Receiving objects: 1% (6/668773)\nerror: some unusual fault')).toBe('some unusual fault');
});

test('a network drop is transient and a refusal is not', () => {
	expect(isTransientGitFailure('fatal: early EOF')).toBe(true);
	expect(isTransientGitFailure('error: RPC failed; curl 56 Recv failure: Connection reset by peer')).toBe(true);
	expect(isTransientGitFailure('fatal: the remote end hung up unexpectedly')).toBe(true);
	expect(isTransientGitFailure('fatal: unable to access: could not resolve host: github.com')).toBe(true);
	expect(isTransientGitFailure("fatal: Authentication failed for 'https://github.com/o/r.git'")).toBe(false);

	expect(
		isTransientGitFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled")
	).toBe(false);

	expect(isTransientGitFailure('fatal: Repository not found')).toBe(false);
});

test('a transient failure retries with backoff and succeeds', async () => {
	const waits: number[] = [];
	let runs = 0;

	const outcome = await retryTransientGit(
		async () => (++runs < 3 ? Promise.reject(new Error('git clone failed: fatal: early EOF')) : 'ok'),
		[5, 10],
		async (ms) => {
			waits.push(ms);
		}
	);

	expect(outcome).toBe('ok');
	expect(runs).toBe(3);
	expect(waits).toEqual([5, 10]);
});

test('a refusal is not retried', async () => {
	let runs = 0;

	const failing = () => (++runs, Promise.reject(new Error('git clone failed: Authentication failed')));

	await expect(retryTransientGit(failing, [5, 10], async () => {})).rejects.toThrow('Authentication failed');

	expect(runs).toBe(1);
});

test('the retries are bounded and the last failure says how many times the command ran', async () => {
	let runs = 0;

	const failing = () => (++runs, Promise.reject(new Error('git fetch failed: fatal: early EOF')));

	await expect(retryTransientGit(failing, RETRY_DELAYS_MS, async () => {})).rejects.toThrow(
		`git fetch failed: fatal: early EOF Tried ${RETRY_DELAYS_MS.length + 1} times.`
	);

	expect(runs).toBe(RETRY_DELAYS_MS.length + 1);
});
