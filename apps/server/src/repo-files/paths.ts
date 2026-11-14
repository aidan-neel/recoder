/**
 * Validation for the `path` and `ref` queries of the repo file routes. Both
 * go to git as argv — never through a shell — and the path is matched with
 * `--literal-pathspecs`, so nothing in them is glob or magic. These checks
 * keep the inputs to what a repository can actually hold.
 */

/** The longest path a tracked repository can hold. */
const MAX_REPO_PATH_CHARS = 4096;

/**
 * A commit-ish that is safe as one git argv: no leading `-` (a flag), no `..`
 * (a range), and only ref characters — branches, tags, `refs/...` and shas.
 * `~`, `^`, `:` and `@{...}` are left out; the file panel has no use for them.
 */
const REF_CHARS = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

/** Whether `ref` may name a commit-ish. Anything else is a client error, not a git lookup. */
export function isRepoRef(ref: string): boolean {
	return REF_CHARS.test(ref) && !ref.includes('..') && !ref.endsWith('/') && !ref.endsWith('.');
}

/**
 * `path` as a clean repository-relative path, or null when it is unsafe or
 * unresolvable: no absolute paths, no NUL or control characters, no empty, `.`
 * or `..` segments. Trailing slashes are normalized away; the empty string is
 * the repository root.
 */
export function cleanRepoPath(path: string): string | null {
	if (path.startsWith('/')) return null;

	for (const ch of path) {
		const code = ch.codePointAt(0) ?? 0;

		if (code < 0x20 || code === 0x7f) return null;
	}

	const clean = path.replace(/\/+$/, '');

	if (clean === '') return '';
	if (clean.length > MAX_REPO_PATH_CHARS) return null;
	if (clean.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;

	return clean;
}
