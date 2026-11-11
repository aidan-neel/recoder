import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { env } from '../../env.js';
import { gitConfigEnv, gitOutput, type GitCall } from './git.js';
import type { LocalChange } from './local-change.js';

/** How many hex characters of the repository path's hash keep two same-named repositories apart. */
const PATH_HASH_CHARS = 12;

/**
 * Refs inside the throwaway clone that keep the base and merge-base commits
 * reachable, so a repack that copies borrowed objects in copies theirs too.
 */
const BASE_REF = 'refs/recoder/base';

const MERGE_BASE_REF = 'refs/recoder/merge-base';

/** Never run hooks or print checkout advice in the throwaway clone. */
const CHECKOUT_SETTINGS = { 'core.hooksPath': '/dev/null', 'advice.detachedHead': 'false' };

/**
 * A new folder for one review of the repository at `root`, under the work dir
 * beside the server's PR checkouts. The name follows their
 * `<scope>__pr-<n>__<id>` shape because `scopeOfCheckout` reads the scope from
 * it to share dependency installs, and without a scope every review installs
 * from scratch. The scope holds a hash of the repository's path, so installs
 * are shared only between reviews of the same repository, never with a
 * different one that happens to have the same folder name.
 */
export function throwawayCheckoutPath(root: string): string {
	const pathHash = createHash('sha256').update(root).digest('hex').slice(0, PATH_HASH_CHARS);
	const name = basename(root).replace(/[^A-Za-z0-9._-]/g, '-');

	return join(env.RECODER_WORKDIR, 'repos', `local__${name}-${pathHash}__pr-local__${randomUUID()}`);
}

/**
 * Clones the repository at `call.cwd` into `path` and checks out the head.
 * A local clone hard-links or copies the whole object store, unreachable
 * commits included, so the checkout holds every commit the review reads.
 * Shared object files are safe: git never rewrites one, and the sandbox
 * mounts the checkout's `.git` read-only. Reading the source repository
 * changes nothing in it.
 */
export async function cloneForReview(
	call: GitCall,
	path: string,
	change: Pick<LocalChange, 'baseSha' | 'mergeBaseSha' | 'headSha'>
): Promise<void> {
	const parent = dirname(path);

	await mkdir(parent, { recursive: true });
	await gitOutput({ ...call, cwd: parent }, ['clone', '--quiet', '--local', '--no-checkout', '--', call.cwd, path]);

	const clone = { cwd: path, signal: call.signal };

	await gitOutput({ ...clone, env: gitConfigEnv(CHECKOUT_SETTINGS) }, [
		'checkout',
		'--quiet',
		'--force',
		'--detach',
		change.headSha
	]);

	await stopBorrowing(clone, change);
}

/**
 * A source that borrows objects (`clone --shared` or `--reference`) passes its
 * alternates on to the clone. The sandbox hides the home folder and binds only
 * the checkout, so borrowed objects would be missing inside it: copy every
 * object the review reads into the clone, then stop borrowing. A source with
 * no alternates skips this and keeps the fast hard-linked clone.
 */
async function stopBorrowing(clone: GitCall, change: Pick<LocalChange, 'baseSha' | 'mergeBaseSha'>): Promise<void> {
	const alternates = join(clone.cwd, '.git', 'objects', 'info', 'alternates');

	if (!existsSync(alternates)) return;

	await gitOutput(clone, ['update-ref', BASE_REF, change.baseSha]);
	await gitOutput(clone, ['update-ref', MERGE_BASE_REF, change.mergeBaseSha]);

	await gitOutput(clone, ['repack', '--quiet', '-a', '-d']);
	await rm(alternates);
}
