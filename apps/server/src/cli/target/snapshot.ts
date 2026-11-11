import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { errorCode, notReadyError } from '../exit.js';
import { gitConfigEnv, gitOutput, gitProbe, type GitCall } from './git.js';
import type { LocalChange } from './local-change.js';

/** The name the report and messages give each snapshot's head. */
const STAGED_HEAD = 'staged changes';

const UNCOMMITTED_HEAD = 'uncommitted changes';

/**
 * The private index never splits into a shared part (which git would write
 * into the user's git folder) and never starts a file-system monitor daemon.
 */
const PRIVATE_INDEX_SETTINGS = { 'core.splitIndex': 'false', 'core.fsmonitor': 'false' };

/** Who the snapshot commit is by, so it never depends on, or uses, the user's git identity. */
const SNAPSHOT_IDENTITY = {
	GIT_AUTHOR_NAME: 'Recoder',
	GIT_AUTHOR_EMAIL: 'recoder@localhost',
	GIT_COMMITTER_NAME: 'Recoder',
	GIT_COMMITTER_EMAIL: 'recoder@localhost'
};

/** What a snapshot adds to the copied index before it is written as a tree. */
type Stage = (privateIndex: GitCall) => Promise<unknown>;

/** A commit on top of `HEAD` holding exactly what is staged. */
export function commitStaged(call: GitCall): Promise<LocalChange> {
	return commitSnapshot(call, STAGED_HEAD, () => Promise.resolve());
}

/**
 * A commit on top of `HEAD` holding the working tree as it stands, untracked
 * files in and ignored files out. `--sparse` lets the add reach paths outside
 * a sparse checkout's cone, as `git diff HEAD` does; without it git refuses an
 * untracked file there and skips a changed one. Entries outside the cone that
 * are not on disk keep their index version.
 */
export function commitUncommitted(call: GitCall): Promise<LocalChange> {
	return commitSnapshot(call, UNCOMMITTED_HEAD, (privateIndex) =>
		gitOutput(privateIndex, ['add', '--sparse', '--all', '--', ':/'])
	);
}

/**
 * Builds the snapshot in a copy of the user's index, kept in a private temp
 * folder, so the user's index, working tree, HEAD and refs are never written.
 * The only trace in the repository is unreachable objects, which git's own
 * garbage collection removes in time.
 */
async function commitSnapshot(call: GitCall, headName: string, stage: Stage): Promise<LocalChange> {
	const parentSha = await headCommit(call);
	const scratch = await mkdtemp(join(tmpdir(), 'recoder-index-'));

	try {
		const indexFile = join(scratch, 'index');
		const privateIndex = privateIndexCall(call, indexFile);

		await copyIndex(call, indexFile, parentSha);
		await stage(privateIndex);

		const tree = await gitOutput(privateIndex, ['write-tree']);

		const headSha = await gitOutput({ ...call, env: SNAPSHOT_IDENTITY }, [
			'commit-tree',
			'--no-gpg-sign',
			'-p',
			parentSha,
			'-m',
			`Recoder snapshot of ${headName}`,
			tree
		]);

		return { baseName: 'HEAD', headName, baseSha: parentSha, mergeBaseSha: parentSha, headSha };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

async function headCommit(call: GitCall): Promise<string> {
	const sha = await gitProbe(call, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);

	if (!sha)
		throw notReadyError(`The repository at ${call.cwd} has no commits yet, so there is no HEAD to compare with.`);

	return sha;
}

/** Git commands that read and write the index at `indexFile` instead of the user's. */
function privateIndexCall(call: GitCall, indexFile: string): GitCall {
	return { ...call, env: { ...gitConfigEnv(PRIVATE_INDEX_SETTINGS), GIT_INDEX_FILE: indexFile } };
}

/**
 * Copies the user's index to `indexFile`, whole even when the user's is
 * split; a repository without an index starts from `HEAD`'s tree.
 */
async function copyIndex(call: GitCall, indexFile: string, parentSha: string): Promise<void> {
	const userIndex = await gitOutput(call, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);

	try {
		await copyFile(userIndex, indexFile);
	} catch (err) {
		if (errorCode(err) !== 'ENOENT') throw err;
		await gitOutput(privateIndexCall(call, indexFile), ['read-tree', parentSha]);

		return;
	}

	await unsplitIndex(call, dirname(userIndex), indexFile);
}

/**
 * A split index keeps most entries in `sharedindex.*` files beside the user's
 * index, and git refreshes such a file's time whenever it reads the index,
 * even to write a tree. So the copy is made whole first, in a shadow git
 * folder holding copies of those files, and no later command reads the
 * user's. The shadow uses the repository's object format, since an index
 * holds object names of that format's length. An index that is not split is
 * left as it is.
 */
async function unsplitIndex(call: GitCall, userGitDir: string, indexFile: string): Promise<void> {
	const sharedIndexes = (await readdir(userGitDir)).filter((name) => name.startsWith('sharedindex.'));

	if (!sharedIndexes.length) return;

	const scratch = dirname(indexFile);
	const shadow = join(scratch, 'shadow');
	const privateIndex = privateIndexCall(call, indexFile);
	const objectFormat = await gitOutput(call, ['rev-parse', '--show-object-format']);

	await gitOutput({ ...call, cwd: scratch }, ['init', '--bare', '--quiet', `--object-format=${objectFormat}`, shadow]);
	await Promise.all(sharedIndexes.map((name) => copyFile(join(userGitDir, name), join(shadow, name))));

	await gitOutput({ ...privateIndex, cwd: scratch, env: { ...privateIndex.env, GIT_DIR: shadow } }, [
		'update-index',
		'--no-split-index'
	]);
}
