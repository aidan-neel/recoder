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

const discussionsSchema = z.array(
	z.object({
		id: z.string(),
		notes: z.array(
			z.object({
				id: z.number(),
				body: z.string().nullable().optional(),
				type: z.string().nullable().optional(),
				resolved: z.boolean().nullable().optional()
			})
		)
	})
);

/** One merge request discussion: a thread of notes, the first of which may sit on a diff line. */
export type GitlabDiscussion = z.infer<typeof discussionsSchema>[number];

/** One merge request on GitLab: its API path and the reads and writes its comments share. */
export interface GitlabMergeRequest {
	/** `projects/<slug>`, URL-encoded. */
	project: string;
	/** `projects/<slug>/merge_requests/<iid>`. */
	path: string;
	/** A GitLab API read, relative to the API root. */
	read(path: string): Promise<unknown>;
	/** A note GitLab answered with, as Recoder's posted comment linked to it. */
	linked(value: unknown): Promise<PostedComment>;
	/** Without a token, writes go through `glab`'s login; with neither there is nothing to write as. */
	write(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Promise<unknown>;
	/** Every discussion on the merge request. Throws a conflict when there are more than Recoder reads. */
	discussions(): Promise<GitlabDiscussion[]>;
	/** A new diff discussion on one line of the merge request's diff. */
	createDiffDiscussion(body: string, target: InlineTarget): Promise<PostedComment>;
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
 * The merge request's API handle, through the REST API (or `glab api`
 * without a token). GitLab links each note as the merge request's URL with
 * `#note_<id>`.
 */
export function gitlabMergeRequest(
	slug: string,
	iid: number,
	prUrl: string | null,
	env: Record<string, string>
): GitlabMergeRequest {
	const project = `projects/${encodeURIComponent(slug)}`;
	const mr = `${project}/merge_requests/${iid}`;
	let merge: Promise<{ web_url?: unknown; diff_refs?: DiffRefs | null }> | null = null;

	const loadMerge = () => (merge ??= glabApi(mr, env) as Promise<{ web_url?: unknown; diff_refs?: DiffRefs | null }>);

	async function linked(value: unknown): Promise<PostedComment> {
		const note = value as GitlabNote | null;

		if (typeof note?.id !== 'number') throw new GhError('unknown', 'GitLab answered without the note it posted.');

		const base = prUrl ?? String((await loadMerge()).web_url ?? '');

		return { id: String(note.id), url: `${base}#note_${note.id}` };
	}

	function write(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Promise<unknown> {
		if (!env.GITLAB_TOKEN && useGitlabApi(env))
			throw new GhError('auth', 'Connect a GitLab token with the api scope in Settings → Connections.');

		return glabWrite(method, path, body, env);
	}

	async function diffRefs(): Promise<DiffRefs> {
		try {
			const loaded = (await loadMerge()).diff_refs;

			if (!loaded) throw new GhError('unknown', 'GitLab has not computed this merge request’s diff yet.');

			return loaded;
		} catch (error) {
			throw new InlinePreparationError(error);
		}
	}

	return {
		project,
		path: mr,
		read: (path) => glabApi(path, env),
		linked,
		write,

		async discussions() {
			const all: GitlabDiscussion[] = [];

			for (let page = 1; page <= MAX_PAGES; page++) {
				const rows = discussionsSchema.parse(await glabApi(`${mr}/discussions?per_page=100&page=${page}`, env));

				all.push(...rows);
				if (rows.length < 100) return all;
			}

			throw new PublishConflictError(
				'The merge request has too many discussions to establish whether Recoder already posted. Check its discussions before retrying.'
			);
		},

		async createDiffDiscussion(body, target) {
			const position = gitlabPosition(await diffRefs(), target);

			const discussion = (await write('POST', `${mr}/discussions`, { body, position })) as {
				notes?: GitlabNote[];
			} | null;

			return linked(discussion?.notes?.[0]);
		}
	};
}

/** Recoder's diff notes whose body holds one of `markers`, earliest first per marker. */
export function diffNotesByMarker(
	discussions: readonly GitlabDiscussion[],
	markers: readonly string[]
): Map<string, GitlabDiscussion['notes'][number]> {
	const found = new Map<string, GitlabDiscussion['notes'][number]>();

	for (const note of discussions.flatMap((discussion) => discussion.notes)) {
		if (note.type !== 'DiffNote' || !note.body) continue;

		const marker = markers.find((candidate) => note.body?.includes(candidate) && !found.has(candidate));

		if (marker) found.set(marker, note);
	}

	return found;
}

/** Merge request notes: the summary is a note, a finding a diff discussion. */
export function gitlabComments(mergeRequest: GitlabMergeRequest): PullCommentForge {
	const { path: mr, read, linked, write } = mergeRequest;

	return {
		limit: GITLAB_LIMIT,

		async find(marker) {
			for (let page = 1; page <= MAX_PAGES; page++) {
				const rows = (await read(`${mr}/notes?sort=asc&order_by=created_at&per_page=100&page=${page}`)) as GitlabNote[];

				const match = rows.find((row) => typeof row.body === 'string' && row.body.includes(marker));

				if (match) return linked(match);
				if (rows.length < 100) return null;
			}

			throw new PublishConflictError(
				'The merge request has too many notes to establish whether Recoder already posted. Check its notes before retrying.'
			);
		},

		async findInline(marker) {
			const note = diffNotesByMarker(await mergeRequest.discussions(), [marker]).get(marker);

			return note ? linked(note) : null;
		},

		async create(body, discussionId) {
			const path = discussionId ? `${mr}/discussions/${encodeURIComponent(discussionId)}/notes` : `${mr}/notes`;

			return linked(await write('POST', path, { body }));
		},

		async edit(id, body) {
			return linked(await write('PUT', `${mr}/notes/${id}`, { body }));
		},

		createInline: (body, target) => mergeRequest.createDiffDiscussion(body, target),

		async editInline(id, body) {
			return linked(await write('PUT', `${mr}/notes/${id}`, { body }));
		}
	};
}
