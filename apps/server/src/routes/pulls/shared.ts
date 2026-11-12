import type { Context } from 'hono';
import type { Repo } from '@recoder/shared';
import { GhError } from '../../forge/cli';
import { UnsupportedPullAction } from '../../forge/pulls/status';
import { db } from '../../store';

/** Repository ids are UUIDs; anything else can't name one. */
const REPO_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The pull request a `/:id/pulls/:pr/...` route names. */
export interface PullTarget {
	repo: Repo;
	n: number;
}

/** The tracked repository and the positive pull request number in the path, or the 400 or 404 that says why not. */
export async function requirePull(c: Context): Promise<PullTarget | Response> {
	const id = c.req.param('id') ?? '';
	const n = Number(c.req.param('pr'));

	if (!REPO_ID.test(id)) return c.json({ error: 'invalid repository id' }, 400);
	if (!Number.isSafeInteger(n) || n <= 0) return c.json({ error: 'invalid pull request number' }, 400);

	const repo = await db.repos.get(id);

	if (!repo) return c.json({ error: 'repo not found' }, 404);

	return { repo, n };
}

/**
 * Answers `answer`'s result, or the forge failure as a status: what the forge
 * cannot do here (400), nothing there (404), forge trouble (502) with its kind
 * so the app can offer Connections. Anything else is the app's own error handler's.
 */
export async function withForge(c: Context, answer: () => Promise<Response>): Promise<Response> {
	try {
		return await answer();
	} catch (err) {
		if (err instanceof UnsupportedPullAction) return c.json({ error: err.message }, 400);
		if (err instanceof GhError && err.kind === 'not-found') return c.json({ error: err.message, kind: err.kind }, 404);
		if (err instanceof GhError) return c.json({ error: err.message, kind: err.kind }, 502);
		throw err;
	}
}
