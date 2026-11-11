import { notReadyError, usageError } from '../exit.js';
import { gitProbe, type GitCall } from './git.js';
import type { LocalChange } from './local-change.js';

/** Local branches tried, in order, when the repository has no `origin/HEAD`. */
const DEFAULT_BRANCHES = ['main', 'master'];

/**
 * Commits on `head` since it left `base`: the change starts at their merge
 * base, so commits that landed on `base` meanwhile are not part of it. A null
 * base is the repository's default branch. Reads refs only; nothing is fetched.
 */
export async function resolveRange(call: GitCall, range: { base: string | null; head: string }): Promise<LocalChange> {
	const baseName = range.base ?? (await defaultBranch(call));
	const baseSha = await commitOf(call, baseName);
	const headSha = await commitOf(call, range.head);
	const mergeBaseSha = await gitProbe(call, ['merge-base', baseSha, headSha]);

	if (!mergeBaseSha) throw usageError(`${baseName} and ${range.head} share no history, so there is no merge base.`);

	return { baseName, headName: range.head, baseSha, mergeBaseSha, headSha };
}

/** `origin/HEAD` when the clone recorded it, else the first local default branch that exists. */
async function defaultBranch(call: GitCall): Promise<string> {
	const remoteHead = await gitProbe(call, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);

	if (remoteHead) return remoteHead;

	for (const branch of DEFAULT_BRANCHES) {
		if ((await gitProbe(call, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])) !== null) return branch;
	}

	throw notReadyError(
		`Could not find the default branch of ${call.cwd}: there is no origin/HEAD, main or master. Pass --base.`
	);
}

/** The commit a ref names. A ref is caller input, so one that git could read as an option is refused. */
async function commitOf(call: GitCall, ref: string): Promise<string> {
	if (!ref.trim()) throw usageError('A revision to compare is empty.');
	if (ref.startsWith('-'))
		throw usageError(`The revision "${ref}" starts with "-", which git would read as an option.`);

	const sha = await gitProbe(call, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);

	if (!sha) throw usageError(`"${ref}" is not a commit in ${call.cwd}.`);

	return sha;
}
