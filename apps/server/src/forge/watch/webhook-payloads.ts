import { gitlabAuthor, gitlabPull } from './gitlab-feed';
import { githubNote, githubPull } from './github-feed';
import type { WatchedPull } from './cursor';
import type { PullHook } from './webhook-event';

type Row = Record<string, unknown>;

function row(value: unknown): Row {
	return typeof value === 'object' && value !== null ? (value as Row) : {};
}

function urls(repo: Row, keys: string[]): string[] {
	return keys.flatMap((key) => (typeof repo[key] === 'string' ? [repo[key]] : []));
}

/**
 * A GitLab "Merge Request Hook" (open and reopen, or an update with `oldrev`,
 * which is a push) or a "Note Hook" on an open merge request, as a pull
 * request event. Anything else is null.
 */
export function gitlabHook(payload: unknown): PullHook | null {
	const body = row(payload);
	const project = row(body.project);
	const repoUrls = urls(project, ['web_url', 'git_http_url', 'git_ssh_url', 'http_url', 'url']);
	const attributes = row(body.object_attributes);

	if (body.object_kind === 'merge_request') {
		const pull = gitlabPull(attributes);
		const action = attributes.action;

		if (attributes.state !== 'opened' || pull.number <= 0) return null;
		if (action === 'open' || action === 'reopen') return { repoUrls, pull, event: { kind: 'opened' } };

		if (action === 'update' && typeof attributes.oldrev === 'string' && attributes.oldrev) {
			return { repoUrls, pull, event: { kind: 'pushed' } };
		}

		return null;
	}

	const merge = row(body.merge_request);

	if (body.object_kind !== 'note' || attributes.noteable_type !== 'MergeRequest' || merge.state !== 'opened')
		return null;
	if (typeof attributes.id !== 'number' || attributes.system === true) return null;

	const pull = gitlabPull(merge);
	const discussionId = typeof attributes.discussion_id === 'string' ? attributes.discussion_id : undefined;

	return {
		repoUrls,
		pull,
		event: {
			kind: 'mention',
			note: {
				id: attributes.id,
				stream: 'comment',
				author: gitlabAuthor(body.user),
				body: typeof attributes.note === 'string' ? attributes.note : '',
				createdAt: new Date().toISOString(),
				...(discussionId ? { discussionId } : {})
			}
		}
	};
}

/** A pull request issue comment carries no head commit or draft flag, so those stay unknown. */
function issuePull(issue: Row): WatchedPull {
	return { number: Number(issue.number ?? 0), headSha: '', draft: issue.draft === true, createdAt: '', updatedAt: '' };
}

/**
 * GitHub `pull_request` (opened and reopened, or synchronize, a push),
 * `issue_comment` on an open pull request and `pull_request_review_comment`,
 * as a pull request event. Anything else is null.
 */
export function githubHook(event: string | undefined, payload: unknown): PullHook | null {
	const body = row(payload);
	const repoUrls = urls(row(body.repository), ['html_url', 'clone_url', 'ssh_url']);

	if (event === 'pull_request') {
		const pull = githubPull(row(body.pull_request));

		if (pull.number <= 0) return null;
		if (body.action === 'opened' || body.action === 'reopened') return { repoUrls, pull, event: { kind: 'opened' } };
		if (body.action === 'synchronize') return { repoUrls, pull, event: { kind: 'pushed' } };

		return null;
	}

	if (body.action !== 'created') return null;

	const issue = row(body.issue);

	const pull =
		event === 'issue_comment' && issue.pull_request && issue.state === 'open'
			? issuePull(issue)
			: event === 'pull_request_review_comment'
				? githubPull(row(body.pull_request))
				: null;

	const [note] = githubNote(row(body.comment), event === 'issue_comment' ? 'comment' : 'review');

	if (!pull || pull.number <= 0 || !note) return null;

	return { repoUrls, pull, event: { kind: 'mention', note } };
}
