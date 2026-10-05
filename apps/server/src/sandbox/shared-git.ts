import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Runs git in a directory with the review's credentials; throws when git fails. */
export type GitRun = (cwd: string, args: string[], label: string) => Promise<string>;

/** How long a fetched shared copy counts as current. */
const FRESH_MS = 60_000;

const fetched = new Map<string, number>();
const running = new Map<string, Promise<string | null>>();

/**
 * A bare copy of the repo that every review checkout of it borrows objects
 * from (`git clone --reference`), so the history is downloaded once. It is
 * created beside its final place and renamed in, and refreshed at most once a
 * minute. Automatic garbage collection is off: a collection could drop objects
 * a running checkout still reads. Null when the copy cannot be made, and the
 * caller clones on its own.
 */
export function ensureSharedClone(opts: {
	workDir: string;
	repoSlug: string;
	cloneUrl: string;
	run: GitRun;
}): Promise<string | null> {
	const path = join(opts.workDir, 'shared', 'git', `${opts.repoSlug.split('/').join('__')}.git`);
	const pending = running.get(path);

	if (pending) return pending;

	const job = refresh(path, opts).finally(() => running.delete(path));

	running.set(path, job);

	return job;
}

async function refresh(path: string, opts: { workDir: string; cloneUrl: string; run: GitRun }): Promise<string | null> {
	try {
		if (!existsSync(join(path, 'objects'))) {
			const building = `${path}.tmp-${randomUUID().slice(0, 8)}`;

			await mkdir(join(opts.workDir, 'shared', 'git'), { recursive: true });

			try {
				await opts.run(opts.workDir, ['clone', '--bare', '--', opts.cloneUrl, building], 'shared clone');
				await opts.run(building, ['config', 'gc.auto', '0'], 'shared config');
				await opts.run(building, ['config', 'maintenance.auto', 'false'], 'shared config');
				await rename(building, path).catch(() => {});
			} finally {
				await rm(building, { recursive: true, force: true });
			}

			fetched.set(path, Date.now());
		} else if (Date.now() - (fetched.get(path) ?? 0) > FRESH_MS) {
			await opts.run(path, ['fetch', '--prune', 'origin', '+refs/heads/*:refs/heads/*'], 'shared fetch');
			fetched.set(path, Date.now());
		}

		return existsSync(join(path, 'objects')) ? path : null;
	} catch {
		return null;
	}
}
