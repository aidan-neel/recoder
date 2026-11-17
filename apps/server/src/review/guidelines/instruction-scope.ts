/** Characters a path can continue with, so `apps/web/AGENTS.md` names that file and not the root `AGENTS.md`. */
const PATH_CHAR = String.raw`[\w./-]`;

/** Whether `text` names `path` as a whole path, not as the tail or start of a longer one. */
function namesPath(text: string, path: string): boolean {
	const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

	return new RegExp(`(?<!${PATH_CHAR})${escaped}(?![\\w/-])`).test(text);
}

/**
 * The instruction files (`AGENTS.md`, `CLAUDE.md`…) a review reads beside the repo's Recoder guidelines. A repo
 * that has a `RECODER.md` chose what it is reviewed against, and files written for coding agents are not that, so only
 * the ones it names by path count. A nested file must be named by its full path. Without guidelines, every file
 * counts.
 */
export function instructionFilesFor<T extends string>(guidelines: string | null | undefined, paths: readonly T[]): T[] {
	if (!guidelines?.trim()) return [...paths];

	return paths.filter((path) => namesPath(guidelines, path));
}
