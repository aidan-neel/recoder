/** Where Bun keeps the files of a binary built with `bun build --compile`. */
const COMPILED_ROOT = '/$bunfs/';

/**
 * The command that starts this program again, for a background review or a clean copy
 * of this process. The `recoder` binary runs as itself. From source, Bun runs
 * `sourceEntry`, the script the caller wants started.
 */
export function selfCommand(sourceEntry: string): string[] {
	return Bun.main.startsWith(COMPILED_ROOT) ? [process.execPath] : [process.execPath, sourceEntry];
}
