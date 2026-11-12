import { expect, test } from 'bun:test';

import { failureReason } from '../../src/lib/review/failure-reason';

/** What `gh` wrote when GitHub refused a diff of more than 300 files, as the server stored it. */
const TOO_LARGE =
	"[stderr]\ncould not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API or locally cloning the repository instead. (https://api.github.com/repos/acme/api/pulls/154)\nPullRequest.diff too_large";

/** What the server stores when `gh` refused the token: its own prefix, then the CLI's output. */
const REJECTED =
	'gh not authenticated: [stderr]\nHTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with: gh auth login';

/** GitHub's own answer for a refused token, stored without the server's forge CLI prefix. */
const BAD_CREDENTIALS = '[stderr]\nHTTP 401: Bad credentials (https://api.github.com/repos/acme/api/pulls/154)';

/** Marks of raw tool output that must never show as the reason. */
const RAW_MARKS = /\[std(?:err|out)\]|https?:|HTTP \d|too_large|gh auth login|not authenticated/;

test('a diff over the forge’s limit reads in plain words, keeps the output for Details and offers no Continue', () => {
	const reason = failureReason(TOO_LARGE);

	expect(reason).toMatchObject({ text: 'GitHub won’t send a diff of more than 300 files.', next: 'none' });
	expect(reason.raw).toStartWith('could not find pull request diff');
});

test('a diff over the forge’s limit with no file count never shows the tool’s words as the reason', () => {
	for (const summary of [
		'[stderr] gh: maximum number of files exceeded (too_large)',
		'{"errors":[{"resource":"PullRequest","field":"diff","code":"too_large"}]}'
	]) {
		const reason = failureReason(summary);

		expect(reason).toMatchObject({ text: 'The diff is too large for the forge to send.', next: 'none' });
		expect(reason.raw).not.toContain('[stderr]');
	}
});

test('a rejected forge token points to Connections, wherever the CLI’s words start', () => {
	for (const summary of [
		REJECTED,
		`[stderr]\n${REJECTED}`,
		`fetching the pull request: ${REJECTED}`,
		BAD_CREDENTIALS
	]) {
		const reason = failureReason(summary);

		expect(reason.next).toBe('connections');
		expect(reason.text).not.toMatch(RAW_MARKS);
		expect(reason.raw).not.toContain('[stderr]');
	}
});

test('a 401 from a tool other than the forge CLI does not point to Connections', () => {
	const reason = failureReason('[stderr]\nError: HTTP 401: invalid x-api-key (https://api.example.com/v1/messages)');

	expect(reason.next).toBe('continue');
	expect(reason.text).not.toMatch(RAW_MARKS);
	expect(reason.raw).toBe('Error: HTTP 401: invalid x-api-key (https://api.example.com/v1/messages)');
});

test('tool output with no known cause goes to Details, and the server’s own sentences pass through', () => {
	const tool = failureReason('[stderr]\nfatal: unable to access (https://example.com)');

	expect(tool.next).toBe('continue');
	expect(tool.text).not.toMatch(RAW_MARKS);
	expect(tool.raw).toBe('fatal: unable to access (https://example.com)');

	expect(failureReason('The server restarted mid-review. Progress so far was kept.')).toEqual({
		text: 'The server restarted mid-review. Progress so far was kept.',
		raw: null,
		next: 'continue'
	});
});
