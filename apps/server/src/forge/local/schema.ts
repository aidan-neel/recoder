import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { GhError } from '../cli.js';
import { localGit } from './git.js';

/** A comment on a pull, an issue or a review thread. */
const commentSchema = z.object({
	author: z.string(),
	body: z.string(),
	createdAt: z.string()
});

/** What pulls and issues share: a numbered post with its author, labels and discussion. */
const postSchema = z.object({
	number: z.number().int().positive(),
	title: z.string(),
	body: z.string(),
	author: z.string(),
	createdAt: z.string(),
	labels: z.array(z.string()).optional(),
	comments: z.array(commentSchema).optional()
});

const pullSchema = postSchema.extend({
	state: z.enum(['open', 'merged', 'closed']),
	draft: z.boolean().optional(),
	headRef: z.string(),
	baseRef: z.string(),
	/** The base branch commit the PR was cut from; its commits are `baseSha..refs/pull/N/head`. */
	baseSha: z.string(),
	/** Merged PRs: the commit on the base branch that landed it. */
	mergeSha: z.string().optional(),
	reviewers: z.array(z.string()).optional(),
	assignees: z.array(z.string()).optional(),
	/** Issue numbers this PR closes. */
	closes: z.array(z.number().int().positive()).optional(),
	threads: z.array(z.object({ path: z.string(), line: z.number().int(), comments: z.array(commentSchema) })).optional()
});

const issueSchema = postSchema.extend({
	state: z.enum(['open', 'closed'])
});

/**
 * The simulated forge behind a `local` repo: pull requests and issues for a
 * git repo on disk, kept in its git dir so clones never carry it and PR code
 * under review can't read it. Unknown fields are ignored, since other tooling
 * writes the file.
 */
const forgeSchema = z.object({
	defaultBranch: z.string().min(1),
	pulls: z.array(pullSchema),
	issues: z.array(issueSchema)
});

export type LocalComment = z.infer<typeof commentSchema>;

export type LocalPull = z.infer<typeof pullSchema>;

export type LocalForge = z.infer<typeof forgeSchema>;

/** The metadata file's name inside the repo's git dir. */
const FORGE_FILE = 'recoder-forge.json';

/** The repo directory a `file://` repo URL points at (bare or with a work tree). */
export function localRepoPath(repoUrl: string): string {
	return fileURLToPath(repoUrl);
}

/** The absolute git dir of the repo at `repoUrl`; throws a GhError when it isn't a git repo. */
export async function localGitDir(repoUrl: string): Promise<string> {
	return localGit(localRepoPath(repoUrl), ['rev-parse', '--absolute-git-dir']);
}

/** The repo's simulated forge, read fresh on every call so edits to the file apply at once. */
export async function readLocalForge(repoUrl: string): Promise<LocalForge> {
	const file = join(await localGitDir(repoUrl), FORGE_FILE);
	let raw: string;

	try {
		raw = await readFile(file, 'utf8');
	} catch {
		throw new GhError('unknown', `No pull request metadata: ${file} is missing`);
	}

	let json: unknown;

	try {
		json = JSON.parse(raw);
	} catch {
		throw new GhError('unknown', `${file} is not valid JSON`);
	}

	const parsed = forgeSchema.safeParse(json);

	if (!parsed.success) throw new GhError('unknown', `${file} is invalid: ${parsed.error.message.slice(0, 500)}`);

	return parsed.data;
}

/** The pull request numbered `n`, or a not-found GhError like a hosted forge's. */
export function findLocalPull(forge: LocalForge, n: number): LocalPull {
	const pull = forge.pulls.find((row) => row.number === n);

	if (!pull) throw new GhError('not-found', `No pull request #${n} in ${FORGE_FILE}`);

	return pull;
}
