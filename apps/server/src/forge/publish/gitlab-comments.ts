import { GhError } from '../cli';
import { useGitlabApi } from '../gitlab-api';
import { glabApi, glabWrite } from '../glab';
import type { InlineTarget, PostedComment, PullCommentForge } from './forge';
import { InlinePreparationError, PublishConflictError } from './forge';
import { z } from 'zod';

/** GitLab's limit on a note body, in characters. */
const GITLAB_LIMIT = 1_000_000;

/** Pages of notes searched for Recoder's marker. */
const MAX_PAGES = 10;

interface GitlabNote {
	id?: unknown;
	body?: unknown;
}

/** The commits GitLab pins a diff note to. */
interface DiffRefs {
	base_sha: string;
	start_sha: string;
	head_sha: string;
}

/** A diff note's position, from the merge request's `diff_refs` and the line; a context line names both sides. */
function gitlabPosition(refs: DiffRefs, target: InlineTarget): Record<string, unknown> {
	return {
		position_type: 'text',
		base_sha: refs.base_sha,
		start_sha: refs.start_sha,
		head_sha: refs.head_sha,
		old_path: target.oldPath,
		new_path: target.path,
		...(target.oldLine !== null ? { old_line: target.oldLine } : {}),
		...(target.newLine !== null ? { new_line: target.newLine } : {})
	};
}

/**
 * Merge request notes through the REST API (or `glab api` without a token).
 * The summary is a note, a finding a diff discussion; GitLab links each note
 * as the merge request's URL with `#note_<id>`.
 */
export function gitlabComments(
	slug: string,
	iid: number,
	prUrl: string | null,
	env: Record<string, string>
): PullCommentForge {
	const mr = `projects/${encodeURIComponent(slug)}/merge_requests/${iid}`;
	let merge: Promise<{ web_url?: unknown; diff_refs?: DiffRefs | null }> | null = null;

	const loadMerge = () => (merge ??= glabApi(mr, env) as Promise<{ web_url?: unknown; diff_refs?: DiffRefs | null }>);

	async function linked(value: unknown): Promise<PostedComment> {
		const note = value as GitlabNote | null;

		if (typeof note?.id !== 'number') throw new GhError('unknown', 'GitLab answered without the note it posted.');

		const base = prUrl ?? String((await loadMerge()).web_url ?? '');

		return { id: String(note.id), url: `${base}#note_${note.id}` };
	}

	/** Without a token, writes go through `glab`'s login; with neither there is nothing to write as. */
	function write(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Promise<unknown> {
		if (!env.GITLAB_TOKEN && useGitlabApi(env))
			throw new GhError('auth', 'Connect a GitLab token with the api scope in Settings → Connections.');

		return glabWrite(method, path, body, env);
	}

	return {
		limit: GITLAB_LIMIT,

		async find(marker) {
			for (let page = 1; page <= MAX_PAGES; page++) {
				const rows = (await glabApi(
					`${mr}/notes?sort=asc&order_by=created_at&per_page=100&page=${page}`,
					env
				)) as GitlabNote[];

				const match = rows.find((row) => typeof row.body === 'string' && row.body.includes(marker));

				if (match) return linked(match);
				if (rows.length < 100) return null;
			}

			throw new PublishConflictError(
				'The merge request has too many notes to establish whether Recoder already posted. Check its notes before retrying.'
			);
		},

		async findInline(marker) {
			const discussionsSchema = z.array(
				z.object({
					notes: z.array(
						z.object({
							id: z.number(),
							body: z.string().nullable().optional(),
							type: z.string().nullable().optional()
						})
					)
				})
			);

			for (let page = 1; page <= MAX_PAGES; page++) {
				const discussions = discussionsSchema.parse(await glabApi(`${mr}/discussions?per_page=100&page=${page}`, env));

				const match = discussions
					.flatMap((discussion) => discussion.notes)
					.find((note) => note.type === 'DiffNote' && note.body?.includes(marker));

				if (match) return linked(match);
				if (discussions.length < 100) return null;
			}

			throw new PublishConflictError(
				'The merge request has too many discussions to establish whether Recoder already posted. Check its discussions before retrying.'
			);
		},

		async create(body, discussionId) {
			const path = discussionId ? `${mr}/discussions/${encodeURIComponent(discussionId)}/notes` : `${mr}/notes`;

			return linked(await write('POST', path, { body }));
		},

		async edit(id, body) {
			return linked(await write('PUT', `${mr}/notes/${id}`, { body }));
		},

		async createInline(body, target) {
			let refs: DiffRefs;

			try {
				const loaded = (await loadMerge()).diff_refs;

				if (!loaded) throw new GhError('unknown', 'GitLab has not computed this merge request’s diff yet.');
				refs = loaded;
			} catch (error) {
				throw new InlinePreparationError(error);
			}

			const discussion = (await write('POST', `${mr}/discussions`, {
				body,
				position: gitlabPosition(refs, target)
			})) as { notes?: GitlabNote[] } | null;

			return linked(discussion?.notes?.[0]);
		},

		async editInline(id, body) {
			return linked(await write('PUT', `${mr}/notes/${id}`, { body }));
		}
	};
}
