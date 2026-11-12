/** The most globs `ignoredPaths` holds. */
export const IGNORED_PATHS_MAX = 100;

/** The longest glob `ignoredPaths` takes, in characters. */
const IGNORED_PATH_MAX_CHARS = 200;

/**
 * Why `glob` cannot join `paths`, or null when it can. `glob` is the trimmed,
 * non-empty text the person typed; `paths` is the saved list the save will
 * write to.
 */
export function ignoredPathError(glob: string, paths: string[]): string | null {
	if (glob.length > IGNORED_PATH_MAX_CHARS) return `A path can be at most ${IGNORED_PATH_MAX_CHARS} characters.`;

	if (paths.includes(glob)) return 'That path is already in the list.';

	if (paths.length >= IGNORED_PATHS_MAX) return `The list holds at most ${IGNORED_PATHS_MAX} paths.`;

	return null;
}
