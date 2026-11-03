import type { Repo } from '@recoder/shared';
import { gitlabProject } from '../gitlab-api.js';
import { glabApi, glabPost } from '../glab.js';
import { tokenEnv } from '../tokens.js';
import type { PullFeed } from './feed.js';
import type { WatchedNote, WatchedPull } from './cursor.js';

/** Pages fetched per list; a busy merge request has a few hundred threads at most. */
const MAX_PAGES = 20;

const PER_PAGE = 100;

/** Every row of a paginated GitLab list, up to `MAX_PAGES`. */
async function allPages(path: string, env: Record<string, string>): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];
	const join = path.includes('?') ? '&' : '?';

	for (let page = 1; page <= MAX_PAGES; page++) {
		const batch = await glabApi(`${path}${join}per_page=${PER_PAGE}&page=${page}`, env);

		if (!Array.isArray(batch)) break;
		rows.push(...(batch as Record<string, unknown>[]));
		if (batch.length < PER_PAGE) break;
	}

	return rows;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** A merge request row (REST list or webhook `object_attributes`) as the watcher sees it. */
export function gitlabPull(row: Record<string, unknown>): WatchedPull {
	const lastCommit = row.last_commit as { id?: unknown } | undefined;

	return {
		number: Number(row.iid ?? 0),
		headSha: text(row.sha) || text(lastCommit?.id),
		draft: row.draft === true || row.work_in_progress === true,
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at)
	};
}

/** A note's author login. */
export function gitlabAuthor(value: unknown): string {
	return text((value as { username?: unknown } | null)?.username) || 'unknown';
}

/**
 * Open merge requests and their comments through the REST API with a token,
 * else `glab api`. Threads come from `/discussions`, the only listing that
 * carries the thread id a reply needs. System notes ("added 2 commits") are skipped.
 */
export function gitlabFeed(repo: Repo): PullFeed {
	const env = tokenEnv('gitlab', repo.url);
	const project = gitlabProject(repo.url);

	return {
		async updatedPulls(since) {
			const rows = await allPages(
				`${project}/merge_requests?state=opened&order_by=updated_at&sort=desc&updated_after=${encodeURIComponent(since)}`,
				env
			);

			return rows.map(gitlabPull).filter((pull) => pull.number > 0);
		},
		async notes(number) {
			const threads = await allPages(`${project}/merge_requests/${number}/discussions`, env);

			return threads.flatMap((thread) =>
				(Array.isArray(thread.notes) ? (thread.notes as Record<string, unknown>[]) : []).flatMap(
					(note): WatchedNote[] =>
						note.system === true || typeof note.id !== 'number'
							? []
							: [
									{
										id: note.id,
										stream: 'comment',
										author: gitlabAuthor(note.author),
										body: text(note.body),
										createdAt: text(note.created_at),
										discussionId: text(thread.id) || undefined
									}
								]
				)
			);
		},
		async react(number, noteId) {
			await glabPost(`${project}/merge_requests/${number}/notes/${noteId}/award_emoji`, { name: 'eyes' }, env);
		}
	};
}
