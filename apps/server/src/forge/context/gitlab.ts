import type { PrRef } from '../../review/pipeline/intent/types.js';
import { gitlabGet } from '../gitlab-api.js';
import type { CommentRow, ForgeAdapter, PullRows, StackRow, ThreadRow } from './gather.js';
import { labelNames, names, str, toPrRef, type IssueKey } from './sources.js';

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

function username(user: unknown): string | undefined {
	return str((user as Row | null)?.username);
}

function project(path: string): string {
	return `projects/${encodeURIComponent(path)}`;
}

/** Notes people wrote; GitLab's own system notes ("added 1 commit") are dropped. */
function notes(value: unknown): CommentRow[] {
	return rows(value)
		.filter((note) => note.system !== true)
		.map((note) => ({
			id: String(note.id ?? ''),
			author: username(note.author),
			at: str(note.created_at),
			body: String(note.body ?? '')
		}));
}

function prRef(row: Row): PrRef | null {
	return toPrRef({
		number: row.iid,
		title: row.title,
		url: row.web_url,
		state: row.state,
		headRef: row.source_branch,
		baseRef: row.target_branch
	});
}

/** A linked issue row as a key: its project path when it lives in another project. */
function issueKey(row: Row, projectId: unknown): IssueKey | null {
	const number = Number(row.iid);

	if (!number) return null;
	if (row.project_id === projectId) return { repo: null, number };

	const full = str((row.references as Row | undefined)?.full);

	return full?.includes('#') ? { repo: full.slice(0, full.lastIndexOf('#')), number } : null;
}

/**
 * Discussions on a merge request: single notes are comments, and a discussion
 * anchored to a diff position is a review thread.
 */
function splitDiscussions(discussions: Row[]): { comments: CommentRow[]; threads: ThreadRow[] } {
	const comments: CommentRow[] = [];
	const threads: ThreadRow[] = [];

	for (const discussion of discussions) {
		const raw = rows(discussion.notes);
		const position = raw[0]?.position as Row | undefined;
		const thread = notes(raw);

		if (!position) comments.push(...thread);
		else
			threads.push({
				path: str(position.new_path) ?? str(position.old_path),
				line: Number(position.new_line ?? position.old_line) || undefined,
				comments: thread
			});
	}

	return { comments, threads };
}

/** Reads a GitLab merge request and what surrounds it through the REST API. */
export function gitlabAdapter(
	slug: string,
	iid: number,
	env: Record<string, string>,
	signal: AbortSignal
): ForgeAdapter {
	const get = (path: string) => gitlabGet(path, env, signal);
	const mr = `${project(slug)}/merge_requests/${iid}`;
	const issuePath = (key: IssueKey) => `${project(key.repo ?? slug)}/issues/${key.number}`;
	let projectId: unknown;

	return {
		slug,

		async pull(): Promise<PullRows> {
			const row = (await get(mr)) as Row;
			const milestone = row.milestone as Row | null;

			projectId = row.project_id;

			return {
				number: iid,
				title: String(row.title ?? ''),
				body: String(row.description ?? ''),
				url: str(row.web_url),
				author: username(row.author),
				at: str(row.created_at),
				headRef: String(row.source_branch ?? ''),
				baseRef: String(row.target_branch ?? ''),
				headSha: String(row.sha ?? ''),
				people: {
					author: username(row.author) ?? null,
					reviewers: names(row.reviewers),
					assignees: names(row.assignees),
					labels: labelNames(row.labels),
					milestone: str(milestone?.title) ?? null,
					draft: row.draft === true || row.work_in_progress === true
				}
			};
		},

		async closingIssues(): Promise<IssueKey[]> {
			const [closes, related] = await Promise.all([
				get(`${mr}/closes_issues`).catch(() => []),
				get(`${mr}/related_issues`).catch(() => [])
			]);

			return [...rows(closes), ...rows(related)].flatMap((row) => issueKey(row, projectId) ?? []);
		},

		async issue(key) {
			const issue = (await get(issuePath(key))) as Row;

			return {
				title: String(issue.title ?? ''),
				body: String(issue.description ?? ''),
				url: str(issue.web_url),
				author: username(issue.author),
				at: str(issue.created_at)
			};
		},

		async issueComments(key) {
			return notes(await get(`${issuePath(key)}/notes?sort=asc&order_by=created_at&per_page=50`));
		},

		async conversation() {
			return splitDiscussions(rows(await get(`${mr}/discussions?per_page=100`)));
		},

		async commits() {
			return rows(await get(`${mr}/commits?per_page=100`)).map((row) => ({
				sha: String(row.id ?? ''),
				message: String(row.message ?? ''),
				author: str(row.author_name),
				at: str(row.authored_date) ?? str(row.created_at)
			}));
		},

		async openPulls(filter) {
			const query =
				'head' in filter
					? `source_branch=${encodeURIComponent(filter.head)}`
					: `target_branch=${encodeURIComponent(filter.base)}`;

			const found = rows(await get(`${project(slug)}/merge_requests?state=opened&per_page=20&${query}`));

			return found.flatMap((row): StackRow[] => {
				const ref = prRef(row);

				return ref
					? [{ ref, body: String(row.description ?? ''), author: username(row.author), at: str(row.created_at) }]
					: [];
			});
		}
	};
}

/** The merge requests GitLab says a commit landed in. */
export async function gitlabPrsForCommit(
	slug: string,
	sha: string,
	env: Record<string, string>,
	signal: AbortSignal
): Promise<PrRef[]> {
	const found = rows(await gitlabGet(`${project(slug)}/repository/commits/${sha}/merge_requests`, env, signal));

	return found.flatMap((row) => prRef(row) ?? []);
}
