import type { PrRef } from '../../review/pipeline/intent/types.js';
import { githubRest } from '../github-rest.js';
import type { CommentRow, ForgeAdapter, PullRows, StackRow, ThreadRow } from './gather.js';
import { labelNames, names, str, toPrRef, type IssueKey } from './sources.js';

type Row = Record<string, unknown>;

/** Issues GitHub links as closed by the PR. Needs a token; without one the body's mentions still count. */
const CLOSING_ISSUES_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 8) { nodes { number repository { nameWithOwner } } }
    }
  }
}`;

function rows(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

function login(user: unknown): string | undefined {
	return str((user as Row | null)?.login);
}

function comment(row: Row): CommentRow {
	return {
		id: String(row.id ?? ''),
		author: login(row.user),
		at: str(row.created_at) ?? str(row.submitted_at),
		url: str(row.html_url),
		body: String(row.body ?? '')
	};
}

function prRef(row: Row): PrRef | null {
	const head = row.head as Row | undefined;
	const base = row.base as Row | undefined;

	return toPrRef({
		number: row.number,
		title: row.title,
		url: row.html_url,
		state: row.merged_at ? 'merged' : row.state,
		headRef: head?.ref,
		baseRef: base?.ref
	});
}

/** Inline review comments grouped into threads by the comment they reply to. */
function threads(reviewComments: Row[]): ThreadRow[] {
	const byRoot = new Map<string, ThreadRow>();

	for (const row of reviewComments) {
		const root = String(row.in_reply_to_id ?? row.id ?? '');
		const thread = byRoot.get(root) ?? { comments: [] };

		if (!byRoot.has(root)) {
			thread.path = str(row.path);
			thread.line = Number(row.line ?? row.original_line) || undefined;
			byRoot.set(root, thread);
		}

		thread.comments.push(comment(row));
	}

	return [...byRoot.values()];
}

/** Reads a GitHub pull request and what surrounds it through the REST and GraphQL APIs. */
export function githubAdapter(slug: string, prNumber: number, signal: AbortSignal): ForgeAdapter {
	const get = (path: string) => githubRest(`repos/${slug}/${path}`, { signal });
	const issuePath = (key: IssueKey) => `repos/${key.repo ?? slug}/issues/${key.number}`;

	return {
		slug,

		async pull(): Promise<PullRows> {
			const pr = (await get(`pulls/${prNumber}`)) as Row;
			const milestone = pr.milestone as Row | null;

			return {
				number: prNumber,
				title: String(pr.title ?? ''),
				body: String(pr.body ?? ''),
				url: str(pr.html_url),
				author: login(pr.user),
				at: str(pr.created_at),
				headRef: String((pr.head as Row | undefined)?.ref ?? ''),
				baseRef: String((pr.base as Row | undefined)?.ref ?? ''),
				headSha: String((pr.head as Row | undefined)?.sha ?? ''),
				people: {
					author: login(pr.user) ?? null,
					reviewers: [...names(pr.requested_reviewers), ...names(pr.requested_teams)],
					assignees: names(pr.assignees),
					labels: labelNames(pr.labels),
					milestone: str(milestone?.title) ?? null,
					draft: pr.draft === true
				}
			};
		},

		async closingIssues(): Promise<IssueKey[]> {
			const [owner, name] = slug.split('/');

			const reply = (await githubRest('graphql', {
				method: 'POST',
				body: { query: CLOSING_ISSUES_QUERY, variables: { owner, name, number: prNumber } },
				signal
			})) as { data?: { repository?: { pullRequest?: { closingIssuesReferences?: { nodes?: Row[] } } } | null } };

			const nodes = reply?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];

			return nodes.flatMap((node) => {
				const number = Number(node.number);
				const repo = str((node.repository as Row | undefined)?.nameWithOwner);

				if (!number) return [];

				return [{ repo: repo && repo.toLowerCase() !== slug.toLowerCase() ? repo : null, number }];
			});
		},

		async issue(key) {
			const issue = (await githubRest(issuePath(key), { signal })) as Row;

			if (issue.pull_request) return null;

			return {
				title: String(issue.title ?? ''),
				body: String(issue.body ?? ''),
				url: str(issue.html_url),
				author: login(issue.user),
				at: str(issue.created_at)
			};
		},

		async issueComments(key) {
			return rows(await githubRest(`${issuePath(key)}/comments?per_page=50`, { signal })).map(comment);
		},

		async conversation() {
			const [discussion, reviews, inline] = await Promise.all([
				get(`issues/${prNumber}/comments?per_page=100`).catch(() => []),
				get(`pulls/${prNumber}/reviews?per_page=100`).catch(() => []),
				get(`pulls/${prNumber}/comments?per_page=100`).catch(() => [])
			]);

			return {
				comments: [...rows(discussion), ...rows(reviews)].map(comment),
				threads: threads(rows(inline))
			};
		},

		async commits() {
			return rows(await get(`pulls/${prNumber}/commits?per_page=100`)).map((row) => {
				const commit = (row.commit ?? {}) as Row;
				const author = (commit.author ?? {}) as Row;

				return {
					sha: String(row.sha ?? ''),
					message: String(commit.message ?? ''),
					author: login(row.author) ?? str(author.name),
					at: str(author.date)
				};
			});
		},

		async openPulls(filter) {
			const query =
				'head' in filter
					? `head=${encodeURIComponent(`${slug.split('/')[0]}:${filter.head}`)}`
					: `base=${encodeURIComponent(filter.base)}`;

			return rows(await get(`pulls?state=open&per_page=20&${query}`)).flatMap((row): StackRow[] => {
				const ref = prRef(row);

				return ref ? [{ ref, body: String(row.body ?? ''), author: login(row.user), at: str(row.created_at) }] : [];
			});
		}
	};
}

/** The pull requests GitHub says a commit landed in. */
export async function githubPrsForCommit(slug: string, sha: string, signal: AbortSignal): Promise<PrRef[]> {
	return rows(await githubRest(`repos/${slug}/commits/${sha}/pulls`, { signal })).flatMap((row) => {
		const ref = prRef(row);

		return ref ? [ref] : [];
	});
}
