import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Finding, Review } from '@recoder/shared';
import { publishFindingsReview, submitFindingsAfterRun } from '../../../src/forge/publish/findings-review';
import { saveAutoReviewSettings } from '../../../src/forge/watch/settings';
import { db, reviewDiffs } from '../../../src/store';
import { restoreFetch, stubForge, type ForgeCall } from '../../helpers/forge-fetch';
import { forgetRepo, trackGithubRepo, trackGitlabRepo } from '../../helpers/forge-repo';
import { testReview } from '../../helpers/review';

const API = 'https://api.github.com/repos/acme/app';

/** The pull request adds lines 1 to 6 of src/a.ts. */
const PULL_DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -0,0 +1,6 @@',
	...Array.from({ length: 6 }, (_, index) => `+line ${index + 1}`)
].join('\n');

/** The writes Recoder may make: reviews, statuses and thread resolution. Anything else (a push, a contents write) fails the test. */
const ALLOWED_WRITE = /^https:\/\/api\.github\.com\/(repos\/acme\/app\/(pulls\/7\/reviews|statuses\/\w+)|graphql)$/;

const GITLAB_PROJECT = 'https://git.acme.dev/api/v4/projects/team%2Fapp';
const GITLAB_MR = `${GITLAB_PROJECT}/merge_requests/7`;
const GITLAB_MR_URL = 'https://git.acme.dev/team/app/-/merge_requests/7';

let repoId = '';

/**
 * A GitHub that keeps the reviews and review comments posted to it, refuses
 * a review whose comments it cannot place when `refusePositions` is set, and
 * fails the next review create with a 502 when `failNextReview` is set.
 */
function fakeGithub() {
	const reviews: { id: number; html_url: string; body: string }[] = [];
	const comments: { id: number; html_url: string; body: string }[] = [];
	const state = { refusePositions: false, failNextReview: false, resolvedThreads: [] as string[] };

	const calls = stubForge((call) => {
		const path = call.url.split('?')[0];

		if (call.method === 'GET' && path === `${API}/pulls/7/comments`) return [200, comments];
		if (call.method === 'GET' && path === `${API}/pulls/7/reviews`) return [200, reviews];
		if (call.method === 'POST' && path === `${API}/pulls/7/reviews`) return createReview(call);
		if (call.method === 'POST' && path.startsWith(`${API}/statuses/`)) return [201, {}];
		if (call.method === 'POST' && path === 'https://api.github.com/graphql') return graphql(call);

		return [500, { message: `unexpected ${call.method} ${path}` }];
	});

	function createReview(call: ForgeCall): [number, unknown] {
		const drafts = (call.body?.comments ?? []) as { body: string }[];

		if (state.failNextReview) {
			state.failNextReview = false;

			return [502, { message: 'Server Error' }];
		}

		if (state.refusePositions && drafts.length) return [422, { message: 'Line could not be resolved' }];

		const review = {
			id: 900 + reviews.length,
			html_url: `https://github.com/acme/app/pull/7#review-${reviews.length}`,
			body: String(call.body?.body)
		};

		reviews.push(review);

		for (const draft of drafts)
			comments.push({
				id: 1000 + comments.length,
				html_url: `https://github.com/acme/app/pull/7#r${comments.length}`,
				body: draft.body
			});

		return [200, review];
	}

	function graphql(call: ForgeCall): [number, unknown] {
		const variables = call.body?.variables as { threadId?: string };

		if (variables.threadId) {
			state.resolvedThreads.push(variables.threadId);

			return [200, { data: { resolveReviewThread: { thread: { isResolved: true } } } }];
		}

		const nodes = comments.map((comment) => ({
			id: `thread-${comment.id}`,
			isResolved: state.resolvedThreads.includes(`thread-${comment.id}`),
			comments: { nodes: [{ databaseId: comment.id }] }
		}));

		return [
			200,
			{
				data: {
					repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } }
				}
			}
		];
	}

	return { calls, reviews, comments, state };
}

interface Note {
	id: number;
	type: string | null;
	body: string;
}

/** A GitLab that keeps the discussions and notes posted to it, and fails the next summary note when `failNextNote` is set. */
function fakeGitlab() {
	const discussions: { id: string; notes: Note[] }[] = [];
	const notes: Note[] = [];
	const state = { failNextNote: false };

	const calls = stubForge((call) => {
		const path = call.url.split('?')[0];

		if (call.method === 'GET' && path === `${GITLAB_MR}/discussions`) return [200, discussions];
		if (call.method === 'GET' && path === `${GITLAB_MR}/notes`) return [200, notes];
		if (call.method === 'GET' && path === GITLAB_MR)
			return [200, { web_url: GITLAB_MR_URL, diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'h' } }];
		if (call.method === 'POST' && path === `${GITLAB_MR}/discussions`) return createDiscussion(call);
		if (call.method === 'POST' && path === `${GITLAB_MR}/notes`) return createNote(call);
		if (call.method === 'POST' && path.startsWith(`${GITLAB_PROJECT}/statuses/`)) return [201, {}];

		return [500, { message: `unexpected ${call.method} ${path}` }];
	});

	function createDiscussion(call: ForgeCall): [number, unknown] {
		const note = { id: 70 + discussions.length, type: 'DiffNote', body: String(call.body?.body) };
		const discussion = { id: `d${note.id}`, notes: [note] };

		discussions.push(discussion);

		return [201, discussion];
	}

	function createNote(call: ForgeCall): [number, unknown] {
		if (state.failNextNote) {
			state.failNextNote = false;

			return [502, { message: 'Server Error' }];
		}

		const note = { id: 80 + notes.length, type: null, body: String(call.body?.body) };

		notes.push(note);

		return [201, note];
	}

	return { calls, discussions, notes, state };
}

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
	return {
		id,
		fingerprint: `fp-${id}`,
		title: `Title ${id}`,
		file: 'src/a.ts',
		line: 2,
		severity: 'error',
		message: `Problem ${id}`,
		verification: { status: 'verified', reason: 'traced it', method: 'trace' },
		...overrides
	};
}

async function review(overrides: Partial<Review> = {}): Promise<Review> {
	const saved = await db.reviews.set(
		testReview({
			repoId,
			prNumber: 7,
			headSha: 'abcdef1234',
			status: 'passed',
			prUrl: 'https://github.com/acme/app/pull/7',
			...overrides
		})
	);

	await reviewDiffs.set(saved.id, PULL_DIFF);

	return saved;
}

function writes(calls: ForgeCall[]): ForgeCall[] {
	return calls.filter((call) => call.method !== 'GET');
}

beforeEach(async () => {
	repoId = await trackGithubRepo();
	saveAutoReviewSettings({ ignoredPaths: [], maxInlineComments: 25, checkThreshold: 'warning' });
});

afterEach(async () => {
	restoreFetch();
	saveAutoReviewSettings({ ignoredPaths: [], maxInlineComments: 25, checkThreshold: 'error' });
	await forgetRepo(repoId);
});

test('submits one review with the summary, inline comments and a suggestion, then sets the commit status', async () => {
	const github = fakeGithub();

	const patch = {
		diff: [
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -3,2 +3,1 @@',
			'-line 3',
			'-line 4',
			'+fixed'
		].join('\n'),
		checks: ['tsc']
	};

	const { id } = await review({
		findings: [
			finding('inline'),
			finding('fixable', { line: 3, endLine: 4, patch }),
			finding('unanchored', { line: 40 })
		]
	});

	const saved = await publishFindingsReview(id);
	const [create, status] = writes(github.calls);

	expect(writes(github.calls).every((call) => ALLOWED_WRITE.test(call.url))).toBe(true);
	expect(create.url).toBe(`${API}/pulls/7/reviews`);
	expect(create.body).toMatchObject({ commit_id: 'abcdef1234', event: 'COMMENT' });

	expect(create.body?.comments).toEqual([
		expect.objectContaining({
			path: 'src/a.ts',
			line: 2,
			side: 'RIGHT',
			body: expect.stringContaining('**Evidence:** Traced in code')
		}),
		expect.objectContaining({
			path: 'src/a.ts',
			line: 4,
			start_line: 3,
			start_side: 'RIGHT',
			body: expect.stringContaining('```suggestion\nfixed\n```')
		})
	]);

	expect(String(create.body?.body)).toContain('#### Other findings (1)');
	expect(String(create.body?.body)).toContain('Title unanchored');
	expect(status.url).toBe(`${API}/statuses/abcdef1234`);
	expect(status.body).toMatchObject({ state: 'failure', context: 'recoder', target_url: github.reviews[0].html_url });
	expect(saved.findingsReview).toMatchObject({ state: 'posted', id: '900' });

	expect(saved.findingComments).toEqual({
		inline: { id: '1000', url: github.comments[0].html_url, inline: true },
		fixable: { id: '1001', url: github.comments[1].html_url, inline: true }
	});
});

test('a repeated request and a second review of the same commit post nothing twice', async () => {
	const github = fakeGithub();
	const first = await review({ findings: [finding('a')] });

	await publishFindingsReview(first.id);
	github.calls.length = 0;
	await publishFindingsReview(first.id);

	expect(github.calls).toEqual([]);

	const again = await review({ findings: [finding('a')] });
	const saved = await publishFindingsReview(again.id);

	expect(github.reviews).toHaveLength(1);
	expect(github.comments).toHaveLength(1);
	expect(saved.findingComments?.a).toMatchObject({ id: '1000', inline: true });
});

test('a position GitHub refuses moves the finding into the summary of the same review', async () => {
	const github = fakeGithub();

	github.state.refusePositions = true;

	const { id } = await review({ findings: [finding('moved')] });

	await publishFindingsReview(id);

	const creates = github.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/pulls/7/reviews'));

	expect(creates).toHaveLength(2);
	expect(creates[1].body?.comments).toEqual([]);
	expect(String(creates[1].body?.body)).toContain('Title moved');
	expect(github.reviews).toHaveLength(1);
});

test('a failed submission is saved on the review, and retrying submits exactly once', async () => {
	const github = fakeGithub();

	github.state.failNextReview = true;

	const { id } = await review({ findings: [finding('a')] });

	await expect(publishFindingsReview(id)).rejects.toThrow('502');

	expect((await db.reviews.get(id))?.findingsReview).toMatchObject({
		state: 'failed',
		error: expect.stringContaining('502')
	});

	const saved = await publishFindingsReview(id);

	expect(github.reviews).toHaveLength(1);
	expect(saved.findingsReview).toMatchObject({ state: 'posted', id: '900' });
	expect(saved.findingsReview?.error).toBeUndefined();
});

test('a new commit resolves the thread of a fixed finding and does not repost a carried one', async () => {
	const github = fakeGithub();
	const fixed = finding('fixed');
	const kept = finding('kept', { line: 3 });

	await publishFindingsReview((await review({ findings: [fixed, kept], createdAt: '2026-01-01T00:00:00.000Z' })).id);
	github.calls.length = 0;

	const next = await review({
		headSha: 'fedcba9876',
		findings: [{ ...kept, id: 'kept-2', history: { firstSeenSha: 'abcdef1234', state: 'carried' } }],
		resolved: [{ finding: fixed, reason: 'bun test now passes', resolvedAtSha: 'fedcba9876' }]
	});

	const saved = await publishFindingsReview(next.id);
	const create = github.calls.find((call) => call.method === 'POST' && call.url.endsWith('/pulls/7/reviews'));

	expect(github.state.resolvedThreads).toEqual(['thread-1000']);
	expect(create?.body?.comments).toEqual([]);
	expect(String(create?.body?.body)).toContain('#### Fixed since the last review (1)');
	expect(saved.findingComments?.['kept-2']).toMatchObject({ id: '1001', inline: true });
});

test('a carried finding whose fingerprint changed keeps its comment, and its thread resolves once it is fixed', async () => {
	const github = fakeGithub();
	const kept = finding('kept', { line: 3 });

	const moved = {
		...kept,
		fingerprint: 'fp-kept-moved',
		history: { firstSeenSha: 'abcdef1234', state: 'carried' as const }
	};

	await publishFindingsReview((await review({ findings: [kept], createdAt: '2026-01-01T00:00:00.000Z' })).id);

	const carried = await publishFindingsReview(
		(await review({ headSha: 'fedcba9876', findings: [moved], createdAt: '2026-01-02T00:00:00.000Z' })).id
	);

	await publishFindingsReview(
		(
			await review({
				headSha: '0123456789',
				findings: [],
				resolved: [{ finding: moved, reason: 'bun test now passes', resolvedAtSha: '0123456789' }]
			})
		).id
	);

	expect(carried.findingComments?.kept).toMatchObject({ id: '1000', inline: true });
	expect(github.state.resolvedThreads).toEqual(['thread-1000']);
});

test('two concurrent requests for the same pull request submit one review', async () => {
	const github = fakeGithub();
	const { id } = await review({ findings: [finding('a')] });

	await Promise.all([publishFindingsReview(id), publishFindingsReview(id)]);

	expect(github.reviews).toHaveLength(1);
});

test('a finding the summary listed is not listed again on a later commit', async () => {
	const github = fakeGithub();

	saveAutoReviewSettings({ maxInlineComments: 0 });
	await publishFindingsReview((await review({ findings: [finding('a')], createdAt: '2026-01-01T00:00:00.000Z' })).id);

	const next = await review({ headSha: 'fedcba9876', findings: [finding('a-2', { fingerprint: 'fp-a' })] });

	await publishFindingsReview(next.id);

	expect(github.reviews).toHaveLength(1);
});

test('a review with no reportable findings sets a passing check and posts no review', async () => {
	const github = fakeGithub();
	const { id } = await review({ findings: [finding('doc', { file: 'docs/a.md' })] });

	saveAutoReviewSettings({ ignoredPaths: ['docs/**'] });
	await publishFindingsReview(id);

	expect(writes(github.calls).map((call) => [call.url, call.body?.state])).toEqual([
		[`${API}/statuses/abcdef1234`, 'success']
	]);
});

test('an automatic review that posts results submits its findings when its run ends; a manual one waits to be asked', async () => {
	const github = fakeGithub();
	const pullComment = { state: 'posted' as const, updatedAt: 'now' };
	const automatic = await review({ trigger: 'webhook', pullComment, findings: [finding('a')] });
	const manual = await review({ headSha: 'fedcba9876', pullComment, findings: [finding('b')] });

	await submitFindingsAfterRun(automatic.id);
	await submitFindingsAfterRun(manual.id);

	expect(github.reviews).toHaveLength(1);
	expect((await db.reviews.get(manual.id))?.findingsReview).toBeUndefined();
});

test('a GitLab retry after the summary note failed posts the summary once, without posting the discussions again', async () => {
	await forgetRepo(repoId);
	repoId = await trackGitlabRepo();

	const gitlab = fakeGitlab();
	const { id } = await review({ prUrl: GITLAB_MR_URL, findings: [finding('a')] });

	gitlab.state.failNextNote = true;
	await expect(publishFindingsReview(id)).rejects.toThrow('502');

	const saved = await publishFindingsReview(id);

	expect(gitlab.discussions).toHaveLength(1);
	expect(gitlab.notes).toHaveLength(1);
	expect(gitlab.notes[0].body).toContain('One finding is on its line below.');
	expect(saved.findingsReview).toMatchObject({ state: 'posted', id: '80' });
});
