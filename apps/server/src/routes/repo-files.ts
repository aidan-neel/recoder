import { Hono, type Context } from 'hono';
import { languageForPath, type Repo, type RepoFile, type RepoTree } from '@recoder/shared';
import { RepoFilesError } from '../repo-files/errors';
import { listDirectory, readRepoFileAt } from '../repo-files/listing';
import { cleanRepoPath, isRepoRef } from '../repo-files/paths';
import { resolveCommit } from '../repo-files/source';
import { db } from '../store';

/** Repository ids are UUIDs; anything else can't name one. */
const REPO_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** One request's git work never runs past this. */
const GIT_TIMEOUT_MS = 10_000;

const app = new Hono();

/** The `:id` repo when it is tracked, else the 400 or 404 that ends the request. */
async function requireRepo(c: Context): Promise<Repo | Response> {
	const id = c.req.param('id') ?? '';

	if (!REPO_ID.test(id)) return c.json({ error: 'invalid repository id' }, 400);

	const repo = await db.repos.get(id);

	return repo ?? c.json({ error: 'repo not found' }, 404);
}

/** The `ref` query when it may name a commit-ish, else the 400 that ends the request; undefined when omitted. */
function requestedRef(c: Context): string | Response | undefined {
	const ref = c.req.query('ref');

	if (ref === undefined) return undefined;

	return isRepoRef(ref) ? ref : c.json({ error: 'invalid ref' }, 400);
}

/**
 * One directory of the repository at `ref`: `?path=` names the directory (the
 * root by default), `?ref=` the commit-ish (the repo's default branch — what a
 * repository chat reads — by default; a review's chat passes its `headSha`).
 */
app.get('/:id/tree', async (c) => {
	const repo = await requireRepo(c);

	if (repo instanceof Response) return repo;

	const ref = requestedRef(c);

	if (ref instanceof Response) return ref;

	const path = cleanRepoPath(c.req.query('path') ?? '');

	if (path === null) return c.json({ error: 'invalid path' }, 400);

	const signal = AbortSignal.timeout(GIT_TIMEOUT_MS);

	try {
		const { root, commit } = await resolveCommit(repo, ref, signal);
		const entries = await listDirectory(root, commit, path, signal);

		return c.json<RepoTree>({ path, ref: ref ?? repo.defaultBranch, commit, entries });
	} catch (err) {
		if (err instanceof RepoFilesError) return c.json({ error: err.message }, err.status);
		throw err;
	}
});

/**
 * One file of the repository at `ref`, same defaults as `/:id/tree`. Binary
 * files answer without `text`; text is cut at `REPO_FILE_TEXT_BYTES`.
 */
app.get('/:id/file', async (c) => {
	const repo = await requireRepo(c);

	if (repo instanceof Response) return repo;

	const ref = requestedRef(c);

	if (ref instanceof Response) return ref;

	const path = c.req.query('path') === undefined ? null : cleanRepoPath(c.req.query('path') ?? '');

	if (!path) return c.json({ error: 'invalid path' }, 400);

	const signal = AbortSignal.timeout(GIT_TIMEOUT_MS);

	try {
		const { root, commit } = await resolveCommit(repo, ref, signal);
		const file = await readRepoFileAt(root, commit, path, signal);

		const body: RepoFile = {
			path,
			ref: ref ?? repo.defaultBranch,
			commit,
			sha: file.sha,
			size: file.size,
			language: languageForPath(path),
			binary: file.binary,
			truncated: file.truncated,
			...(file.text === undefined ? {} : { text: file.text })
		};

		return c.json(body);
	} catch (err) {
		if (err instanceof RepoFilesError) return c.json({ error: err.message }, err.status);
		throw err;
	}
});

export default app;
