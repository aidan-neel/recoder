import type { Context } from 'hono';
import type { Repo } from '@recoder/shared';
import { GhError } from '../../forge/cli';
import { forgeFailureMessage, logForgeFailure } from '../../forge/pulls/failure';
import { PullHeadMoved, UnsupportedPullAction } from '../../forge/pulls/status';
import { db } from '../../store';

/** Repository ids are UUIDs; anything else can't name one. */
const REPO_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The pull request a `/:id/pulls/:pr/...` route names. */
export interface PullTarget {
	repo: Repo;
	n: number;
}

/** Answers `handle` for the pull request the path names, with forge failures as statuses (see {@link withForge}). */
export function pullRoute(handle: (c: Context, target: PullTarget) => Promise<Response>) {
	return async (c: Context) => {
		const target = await requirePull(c);

		if (target instanceof Response) return target;

		return withForge(c, () => handle(c, target));
	};
}

/** The tracked repository and the positive pull request number in the path, or the 400 or 404 that says why not. */
async function requirePull(c: Context): Promise<PullTarget | Response> {
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
 * cannot do here (400), nothing there (404), a head that moved past the one
 * the person saw (409), forge trouble (502) with its kind so the app can offer
 * Connections. A forge failure answers in fixed words, since the forge's own
 * output can quote a credential; the log keeps it, redacted. Anything else is
 * the app's own error handler's.
 */
async function withForge(c: Context, answer: () => Promise<Response>): Promise<Response> {
	try {
		return await answer();
	} catch (err) {
		if (err instanceof UnsupportedPullAction) return c.json({ error: err.message }, 400);
		if (err instanceof PullHeadMoved) return c.json({ error: err.message }, 409);
		if (!(err instanceof GhError)) throw err;

		logForgeFailure(`${c.req.method} ${c.req.path}`, err);

		return c.json({ error: forgeFailureMessage(err), kind: err.kind }, err.kind === 'not-found' ? 404 : 502);
	}
}
