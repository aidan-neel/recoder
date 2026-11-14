import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from '@recoder/shared';
import { env } from '../env';
import { localRepoPath } from '../forge/local/schema';
import { detectProvider, locateRepo } from '../forge/providers';
import { tokenEnv } from '../forge/tokens';
import { ensureRepoClone } from '../sandbox/sandbox';
import { sharedClonePath } from '../sandbox/shared-git';

/**
 * Where the repository's own git copy on this server stands: `ready` at
 * `path`, still `copying` from the forge, or `missing` when there is none and
 * git could not make one, with the reason as copy for the person.
 */
export type RepoGitCopy =
	{ state: 'ready'; path: string } | { state: 'copying' } | { state: 'missing'; reason: string };

/**
 * The repository's own git copy: the folder itself for a local repo, else the
 * shared bare copy reviews borrow from. A hosted repo with no copy yet is
 * cloned now, so its files can be read before any review of it runs; an
 * existing copy is fetched at most once a minute. Waits at most `waitMs` for
 * the clone or fetch, which keeps running after the wait ends; a copy already
 * on disk is used while a fetch runs or after one fails.
 */
export async function repoGitCopy(repo: Repo, waitMs: number): Promise<RepoGitCopy> {
	const provider = repo.provider ?? detectProvider(repo.url);

	if (provider === 'local') {
		const path = localRepoPath(repo.url);

		return hasGitObjects(path)
			? { state: 'ready', path }
			: { state: 'missing', reason: 'This repository’s folder is not a git repository.' };
	}

	const repoSlug = locateRepo(repo.url).slug;
	const cloning = ensureRepoClone({ repoSlug, repoUrl: repo.url, provider, env: tokenEnv(provider, repo.url) });
	const settled = await within(cloning, waitMs);

	if (settled.done && settled.value) return { state: 'ready', path: settled.value };

	const existing = sharedClonePath(env.RECODER_WORKDIR, repoSlug);

	if (hasGitObjects(existing)) return { state: 'ready', path: existing };

	if (!settled.done) return { state: 'copying' };

	return { state: 'missing', reason: 'Could not copy the repository to this server; check its connection.' };
}

/** True when `path` is a git object store: a bare copy's `objects/` or a checkout's `.git`. */
export function hasGitObjects(path: string): boolean {
	return existsSync(join(path, 'objects')) || existsSync(join(path, '.git'));
}

/** `work`'s value when it settles inside `ms`, else `done: false`; `work` keeps running either way. */
async function within<T>(work: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const expired = new Promise<{ done: false }>((resolve) => {
		timer = setTimeout(() => resolve({ done: false }), ms);
	});

	try {
		return await Promise.race([work.then((value) => ({ done: true as const, value })), expired]);
	} finally {
		clearTimeout(timer);
	}
}
