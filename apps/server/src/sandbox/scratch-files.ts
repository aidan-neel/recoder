import { runSandboxed, type RunResult, type SandboxLayout } from './exec-sandbox.js';

/**
 * Scratch files, written and deleted by commands inside the sandbox, so a symlink planted in the checkout cannot
 * redirect a write or a delete to the host.
 */

/** How long one write or delete may take. */
const FILE_TIMEOUT_MS = 10_000;

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command that writes its input to `target`, a quoted path that must not exist yet. */
function newFileCommand(target: string): string {
	return `if [ -e ${target} ] || [ -L ${target} ]; then echo 'path already exists in the checkout; write a new scratch file instead' >&2; exit 1; fi; mkdir -p -- "$(dirname -- ${target})" && cat > ${target}`;
}

/**
 * Writes a file that must not exist yet. An untracked file already there (installed dependencies, build output) is
 * refused, because scratch files are deleted again.
 */
export function writeNewFile(
	layout: SandboxLayout,
	path: string,
	content: string,
	signal?: AbortSignal
): Promise<RunResult> {
	return runSandboxed(layout, newFileCommand(quote(path)), {
		timeoutMs: FILE_TIMEOUT_MS,
		stdin: content,
		signal,
		tier: 'light'
	});
}

/** Replaces a scratch file its owner wrote before. */
export function overwriteFile(
	layout: SandboxLayout,
	path: string,
	content: string,
	signal?: AbortSignal
): Promise<RunResult> {
	const target = quote(path);

	return runSandboxed(layout, `rm -f -- ${target}; ${newFileCommand(target)}`, {
		timeoutMs: FILE_TIMEOUT_MS,
		stdin: content,
		signal,
		tier: 'light'
	});
}

/** Writes each scratch file under `layout`; returns the first path that could not be written. */
export async function placeFiles(
	layout: SandboxLayout,
	files: Map<string, string>,
	signal?: AbortSignal
): Promise<string | null> {
	for (const [path, content] of files) {
		if ((await writeNewFile(layout, path, content, signal)).exitCode !== 0) return path;
	}

	return null;
}

/** Deletes scratch files under `layout`; one that is already gone is not an error. */
export async function removeFiles(layout: SandboxLayout, paths: string[]): Promise<void> {
	if (!paths.length) return;

	await runSandboxed(layout, `rm -f -- ${paths.map(quote).join(' ')}`, {
		timeoutMs: FILE_TIMEOUT_MS,
		tier: 'light'
	}).catch(() => undefined);
}
