import type { PrPerson, PullComment, PullCommit, PullRequest } from '@recoder/shared';
import { isRecoderComment, str } from '../context/sources.js';
import { gitlabProject } from '../gitlab-api.js';
import { glabApi } from '../glab.js';
import { gitlabComments } from '../publish/gitlab-comments.js';
import { parseSlug } from '../providers.js';
import { allPages, chronological, record, records, splitMessage } from './status.js';

/** The merge request's commits, oldest first. GitLab lists them newest first, like `git log`. */
export async function gitlabCommits(project: string, iid: number, env: Record<string, string>): Promise<PullCommit[]> {
	const rows = await gitlabPages(`${project}/merge_requests/${iid}/commits`, env);

	return rows.reverse().map((row) => {
		const name = str(row.author_name) ?? 'unknown';

		return {
			sha: String(row.id ?? ''),
			...splitMessage(String(row.message ?? '')),
			author: { login: name, name, avatarUrl: null },
			authoredAt: str(row.authored_date) ?? str(row.created_at) ?? '',
			url: str(row.web_url) ?? null
		};
	});
}

/**
 * Notes people wrote on the merge request, oldest first: a note on a diff
 * position is inline, the rest are comments. GitLab's own system notes
 * ("added 1 commit", "approved this merge request") are left out, and GitLab
 * has no review summaries, so no entry carries a verdict.
 */
export async function gitlabConversation(
	project: string,
	pull: PullRequest,
	env: Record<string, string>
): Promise<PullComment[]> {
	const discussions = await gitlabPages(`${project}/merge_requests/${pull.number}/discussions`, env);

	return chronological(
		discussions.flatMap((discussion) =>
			records(discussion.notes)
				.filter((note) => note.system !== true)
				.map((note) => gitlabNote(note, pull.url))
		)
	);
}

/** Post a note on the merge request through the publish helper, then read it back whole. */
export async function gitlabPostComment(
	repoUrl: string,
	pull: PullRequest,
	body: string,
	env: Record<string, string>
): Promise<PullComment> {
	const posted = await gitlabComments(parseSlug(repoUrl), pull.number, pull.url || null, env).create(body);
	const path = `${gitlabProject(repoUrl)}/merge_requests/${pull.number}/notes/${posted.id}`;

	return gitlabNote(record(await glabApi(path, env)), pull.url);
}

/** Every page of a GitLab list endpoint. */
function gitlabPages(path: string, env: Record<string, string>): Promise<Record<string, unknown>[]> {
	return allPages((query) => glabApi(`${path}?${query}`, env));
}

function gitlabPerson(user: unknown): PrPerson {
	const row = record(user);

	return {
		login: str(row.username) ?? 'unknown',
		name: str(row.name) ?? null,
		avatarUrl: str(row.avatar_url) ?? null
	};
}

/** One note; GitLab links a note as the merge request's URL with `#note_<id>`. */
function gitlabNote(note: Record<string, unknown>, mergeUrl: string): PullComment {
	const author = gitlabPerson(note.author);
	const body = String(note.body ?? '');
	const id = String(note.id ?? '');
	const position = record(note.position);
	const path = str(position.new_path) ?? str(position.old_path);
	const line = Number(position.new_line ?? position.old_line);

	return {
		id: `note:${id}`,
		kind: path ? 'inline' : 'comment',
		author,
		body,
		createdAt: str(note.created_at) ?? '',
		url: mergeUrl && id ? `${mergeUrl}#note_${id}` : null,
		...(path ? { path } : {}),
		...(path && Number.isInteger(line) && line > 0 ? { line } : {}),
		byRecoder: isRecoderComment(author.login, body)
	};
}
