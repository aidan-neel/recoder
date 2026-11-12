import { describe, expect, test } from 'bun:test';

import { plainError } from '../../src/lib/api/server-error';

/** The pull request read's answer for a review whose GitHub token was revoked, as the server sends it today. */
const GH_401 =
	'gh not authenticated: [stderr]\nHTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login';

/** A failed review's summary when GitHub refused the diff of a pull request with too many files. */
const DIFF_TOO_LARGE =
	"[stderr]\ncould not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API or locally cloning the repository instead. (https://api.github.com/repos/aidan-neel/sivir-ui/pulls/154)\nPullRequest.diff too_large";

describe('server errors as plain copy', () => {
	test('a gh sign-in failure says the token was rejected and where to fix it, with no CLI output', () => {
		expect(plainError(GH_401)).toBe('GitHub rejected the token. Update it in Settings → Connections.');

		expect(plainError('glab not authenticated: not logged into gitlab.com')).toBe(
			'GitLab isn’t signed in. Add a token in Settings → Connections.'
		);

		expect(plainError('[stderr]\nHTTP 401: Bad credentials (https://api.github.com/graphql)')).toBe(
			'The forge rejected the token. Update it in Settings → Connections.'
		);
	});

	test('a 401 from a service other than the forge is not blamed on the forge’s token', () => {
		expect(
			plainError('[stderr]\nError: HTTP 401: invalid x-api-key (https://api.example.com/v1/messages)')
		).not.toMatch(/forge|Connections/);
	});

	test('a diff GitHub refuses for its size says why in plain words', () => {
		expect(plainError(DIFF_TOO_LARGE)).toBe('GitHub won’t send a diff of more than 300 files.');
	});

	test('stream tags, links, status prefixes and error code lines are taken out of other CLI failures', () => {
		expect(
			plainError(
				'[stderr]\nHTTP 502: GitHub is down for maintenance (https://api.github.com/repos/a/b/pulls)\nPullRequest.list server_error'
			)
		).toBe('GitHub is down for maintenance.');
	});

	test('a parser message or a bare status line holds nothing to show', () => {
		expect(plainError('Unterminated string in JSON at position 13 (line 1 column 14)')).toBe('');
		expect(plainError('Unexpected end of JSON input')).toBe('');
		expect(plainError('502 Bad Gateway')).toBe('');
	});

	test('a bare status phrase holds nothing to show, so the server is never named twice in one notice', () => {
		expect(plainError('internal server error')).toBe('');
		expect(plainError('[stderr]\nHTTP 502: Server Error (https://api.github.com/repos/a/b/pulls)')).toBe('');
	});

	test('a plain server sentence keeps its words, and a long dump is cut at a sentence', () => {
		expect(plainError('GitHub rejected the API token. Update it in Settings → Connections.')).toBe(
			'GitHub rejected the API token. Update it in Settings → Connections.'
		);

		const dump = `${'The forge answered slowly. '.repeat(6)}${'x'.repeat(200)}`;
		const short = plainError(dump);

		expect(short.length).toBeLessThanOrEqual(240);
		expect(short.endsWith('slowly.')).toBe(true);
	});

	test('a message that names a member of every object is said as a sentence, never mistaken for a known one', () => {
		expect(plainError('constructor')).toBe('Constructor.');
		expect(plainError('toString')).toBe('ToString.');
	});
});
