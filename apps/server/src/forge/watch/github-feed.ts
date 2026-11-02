import type { Repo } from '@recoder/shared';
import { githubRest } from '../github-rest.js';
import { parseSlug } from '../providers.js';
import type { PullFeed } from './feed.js';
import type { NoteStream, WatchedNote, WatchedPull } from './cursor.js';

const PER_PAGE = 100;

/** Pages fetched per list. */
const MAX_PAGES = 10;

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** A pull request row (REST or webhook `pull_request`) as the watcher sees it. */
export function githubPull(row: Record<string, unknown>): WatchedPull {
	return {
		number: Number(row.number ?? 0),
		headSha: text((row.head as { sha?: unknown } | undefined)?.sha),
		draft: row.draft === true,
		createdAt: text(row.created_at),
		updatedAt: text(row.updated_at)
	};
}

/** An issue or review comment row as a watched note. */
export function githubNote(row: Record<string, unknown>, stream: NoteStream): WatchedNote[] {
	if (typeof row.id !== 'number') return [];

	return [
		{
			id: row.id,
			stream,
			author: text((row.user as { login?: unknown } | null)?.login) || 'unknown',
			body: text(row.body),
			createdAt: text(row.created_at)
		}
	];
}

/** Comments changed since `since`, oldest first, from one of the two comment lists. */
async function comments(path: string, since: string, stream: NoteStream): Promise<WatchedNote[]> {
	const notes: WatchedNote[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		const rows = (await githubRest(
			`${path}?since=${encodeURIComponent(since)}&per_page=${PER_PAGE}&page=${page}`
		)) as Record<string, unknown>[];

		notes.push(...rows.flatMap((row) => githubNote(row, stream)));
		if (rows.length < PER_PAGE) break;
	}

	return notes;
}

/**
 * Open pull requests and their comments through the REST API. GitHub can't
 * filter pulls by update time, so the list is read newest-updated first and
 * stops at the cursor. Comments are the conversation plus inline review comments.
 */
export function githubFeed(repo: Repo): PullFeed {
	const slug = parseSlug(repo.url);

	return {
		async updatedPulls(since) {
			const cutoff = Date.parse(since);
			const pulls: WatchedPull[] = [];

			for (let page = 1; page <= MAX_PAGES; page++) {
				const rows = (await githubRest(
					`repos/${slug}/pulls?state=open&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`
				)) as Record<string, unknown>[];

				const recent = rows.map(githubPull).filter((pull) => Date.parse(pull.updatedAt) >= cutoff);

				pulls.push(...recent);
				if (rows.length < PER_PAGE || recent.length < rows.length) break;
			}

			return pulls.filter((pull) => pull.number > 0);
		},
		async notes(number, since) {
			const [conversation, inline] = await Promise.all([
				comments(`repos/${slug}/issues/${number}/comments`, since, 'comment'),
				comments(`repos/${slug}/pulls/${number}/comments`, since, 'review')
			]);

			return [...conversation, ...inline];
		},
		async react(_number, noteId, stream) {
			const kind = stream === 'review' ? 'pulls' : 'issues';

			await githubRest(`repos/${slug}/${kind}/comments/${noteId}/reactions`, {
				method: 'POST',
				body: { content: 'eyes' }
			});
		}
	};
}
