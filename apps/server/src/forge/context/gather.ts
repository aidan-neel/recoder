import type { GatheredContext, IntentSource, PrRef } from '../../review/pipeline/intent/types.js';
import { pastReviewSources } from './past-reviews.js';
import {
	CONTEXT_CAPS,
	finishSources,
	isRecoderComment,
	issueLabel,
	makeSource,
	mentionedIssues,
	peopleBlock,
	type IssueKey,
	type PeopleRows
} from './sources.js';

/** The pull request itself, as either host reports it. */
export interface PullRows {
	number: number;
	title: string;
	body: string;
	url?: string;
	author?: string;
	at?: string;
	headRef: string;
	baseRef: string;
	headSha: string;
	people: PeopleRows;
}

/** One comment; `id` breaks ties between comments posted in the same second. */
export interface CommentRow {
	id: string;
	author?: string;
	at?: string;
	url?: string;
	body: string;
}

/** An inline review thread on a file. */
export interface ThreadRow {
	path?: string;
	line?: number;
	comments: CommentRow[];
}

interface IssueRow {
	title: string;
	body: string;
	url?: string;
	author?: string;
	at?: string;
}

interface CommitRow {
	sha: string;
	message: string;
	author?: string;
	at?: string;
}

/** An open pull request next to this one, with its description. */
export interface StackRow {
	ref: PrRef;
	body: string;
	author?: string;
	at?: string;
}

/**
 * What the gatherer asks a forge host. Each provider maps its own payloads to
 * these rows; everything after (refs, clipping, sorting, caps) is shared.
 * Every call but `pull` may fail; a failure only loses that part.
 */
export interface ForgeAdapter {
	/** `owner/repo` or the GitLab project path. */
	slug: string;
	pull(): Promise<PullRows>;
	/** Issues the host links as closed by this PR. */
	closingIssues(pull: PullRows): Promise<IssueKey[]>;
	/** Null when it isn't an issue (GitHub answers PRs on the issues endpoint too). */
	issue(key: IssueKey): Promise<IssueRow | null>;
	issueComments(key: IssueKey): Promise<CommentRow[]>;
	conversation(pull: PullRows): Promise<{ comments: CommentRow[]; threads: ThreadRow[] }>;
	commits(pull: PullRows): Promise<CommitRow[]>;
	/** Open pull requests whose head branch is `head`, or whose base branch is `base`. */
	openPulls(filter: { head: string } | { base: string }): Promise<StackRow[]>;
}

/** An empty context, used when the host can't be reached in time. */
export function emptyContext(): GatheredContext {
	return { sources: [], stack: { parent: null, children: [] }, people: '' };
}

/** `(at, id)` order, so numbering by position is stable across runs. */
function chronological<T extends { at?: string; id?: string }>(rows: T[]): T[] {
	return [...rows].sort(
		(a, b) => (a.at ?? '').localeCompare(b.at ?? '') || (a.id ?? '').localeCompare(b.id ?? '', 'en', { numeric: true })
	);
}

/** Comments numbered by position after dropping Recoder's own and empty ones: `comment:pr/3`, `comment:#12/3`. */
function commentSources(owner: string, comments: CommentRow[]): IntentSource[] {
	return chronological(comments.filter((c) => c.body.trim() && !isRecoderComment(c.author, c.body))).map(
		(comment, index) =>
			makeSource({
				kind: 'comment',
				ref: `comment:${owner}/${index + 1}`,
				url: comment.url,
				author: comment.author,
				at: comment.at,
				text: comment.body
			})
	);
}

function threadSources(prNumber: number, threads: ThreadRow[]): IntentSource[] {
	const kept = threads
		.map((thread) => ({
			...thread,
			comments: chronological(thread.comments.filter((c) => c.body.trim() && !isRecoderComment(c.author, c.body)))
		}))
		.filter((thread) => thread.comments.length > 0);

	const ordered = [...kept].sort(
		(a, b) =>
			(a.comments[0].at ?? '').localeCompare(b.comments[0].at ?? '') ||
			a.comments[0].id.localeCompare(b.comments[0].id, 'en', { numeric: true })
	);

	return ordered.map((thread, index) =>
		makeSource({
			kind: 'review-thread',
			ref: `thread:#${prNumber}/${index + 1}`,
			url: thread.comments[0].url,
			title: thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : undefined,
			author: thread.comments[0].author,
			at: thread.comments[0].at,
			text: thread.comments.map((c) => `${c.author ?? 'someone'}: ${c.body.trim()}`).join('\n\n')
		})
	);
}

function commitSources(commits: CommitRow[]): IntentSource[] {
	return commits
		.filter((commit) => commit.message.trim() && !/^Merge (branch|pull request|remote-tracking)/.test(commit.message))
		.map((commit) =>
			makeSource({
				kind: 'commit',
				ref: `commit:${commit.sha.slice(0, 7)}`,
				title: commit.message.split('\n')[0],
				author: commit.author,
				at: commit.at,
				text: commit.message.split('\n').slice(1).join('\n').trim() || commit.message
			})
		);
}

function stackSource(row: StackRow, relation: 'Parent' | 'Child'): IntentSource {
	const role =
		relation === 'Parent'
			? 'this PR is stacked on it; what it changes is reviewed there'
			: 'stacked on this PR; what it changes is deferred to it';

	return makeSource({
		kind: 'stack',
		ref: `stack:#${row.ref.number}`,
		url: row.ref.url,
		title: `${relation} PR #${row.ref.number}: ${row.ref.title}`,
		author: row.author,
		at: row.at,
		text: `(${role})\n${row.body}`
	});
}

/** The lowest-numbered open PR whose head is this PR's base; several parents are rare and ambiguous. */
function pickParent(rows: StackRow[], self: number): StackRow | null {
	return [...rows].filter((row) => row.ref.number !== self).sort((a, b) => a.ref.number - b.ref.number)[0] ?? null;
}

function pickChildren(rows: StackRow[], self: number): StackRow[] {
	return [...rows]
		.filter((row) => row.ref.number !== self)
		.sort((a, b) => a.ref.number - b.ref.number)
		.slice(0, CONTEXT_CAPS.children);
}

/** Linked and mentioned issues, each with its comments; issues that can't be read are skipped. */
async function issueSources(adapter: ForgeAdapter, keys: IssueKey[], signal: AbortSignal): Promise<IntentSource[]> {
	const read = await Promise.all(
		keys.slice(0, CONTEXT_CAPS.issues).map(async (key) => {
			if (signal.aborted) return [];

			const issue = await adapter.issue(key).catch(() => null);

			if (!issue) return [];

			const comments = await adapter.issueComments(key).catch(() => []);
			const label = issueLabel(key);

			return [
				makeSource({
					kind: 'issue',
					ref: `issue:${label}`,
					url: issue.url,
					title: issue.title,
					author: issue.author,
					at: issue.at,
					text: issue.body
				}),
				...commentSources(label, comments)
			];
		})
	);

	return read.flat();
}

/**
 * Closing issues first, then ones the body or commits mention, without repeats.
 * A GitHub PR mentioning itself is dropped when the issues endpoint answers with a PR;
 * GitLab numbers issues apart from merge requests, so `#4` there is a real issue.
 */
function issueKeys(slug: string, closing: IssueKey[], pull: PullRows, commits: CommitRow[]): IssueKey[] {
	const text = [pull.body, ...commits.map((commit) => commit.message)].join('\n');
	const seen = new Set<string>();

	return [...closing, ...mentionedIssues(text, slug)].filter((key) => {
		const label = issueLabel(key).toLowerCase();

		if (seen.has(label)) return false;
		seen.add(label);

		return true;
	});
}

/**
 * Everything a forge host says about why a PR exists: its description,
 * linked and mentioned issues with their comments, the discussion and review
 * threads, its commits, the PRs stacked around it, and past Recoder reviews of
 * earlier pushes. Throws only when the PR itself can't be read.
 */
export async function gatherWith(adapter: ForgeAdapter, repoId: string, signal: AbortSignal): Promise<GatheredContext> {
	const pull = await adapter.pull();

	const [closing, conversation, commits, parents, children] = await Promise.all([
		adapter.closingIssues(pull).catch(() => []),
		adapter.conversation(pull).catch(() => ({ comments: [], threads: [] })),
		adapter.commits(pull).catch(() => []),
		adapter.openPulls({ head: pull.baseRef }).catch(() => []),
		adapter.openPulls({ base: pull.headRef }).catch(() => [])
	]);

	const issues = await issueSources(adapter, issueKeys(adapter.slug, closing, pull, commits), signal);
	const parent = pickParent(parents, pull.number);
	const kids = pickChildren(children, pull.number);

	const sources = [
		makeSource({
			kind: 'pr',
			ref: 'pr',
			url: pull.url,
			title: pull.title,
			author: pull.author,
			at: pull.at,
			text: pull.body
		}),
		...issues,
		...commentSources('pr', conversation.comments),
		...threadSources(pull.number, conversation.threads),
		...commitSources(commits),
		...(parent ? [stackSource(parent, 'Parent')] : []),
		...kids.map((row) => stackSource(row, 'Child')),
		...pastReviewSources(repoId, pull.number, pull.headSha)
	];

	return {
		sources: finishSources(sources),
		stack: { parent: parent?.ref ?? null, children: kids.map((row) => row.ref) },
		people: peopleBlock(pull.people)
	};
}
