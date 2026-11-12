/** Files larger than this are generated or data, not code worth comparing. */
export const MAX_FILE_BYTES = 100_000;

/** Splits `git cat-file --batch` output into each requested object's text; missing and binary blobs are skipped. */
function parseBatch(bytes: Uint8Array, objects: string[]): Map<string, string> {
	const decoder = new TextDecoder();
	const texts = new Map<string, string>();
	let offset = 0;

	for (const object of objects) {
		const newline = bytes.indexOf(10, offset);

		if (newline < 0) break;

		const header = decoder.decode(bytes.subarray(offset, newline)).split(' ');

		offset = newline + 1;

		if (header[1] !== 'blob') continue;

		const size = Number(header[2]);
		const body = bytes.subarray(offset, offset + size);

		offset += size + 1;
		if (!body.includes(0)) texts.set(object, decoder.decode(body));
	}

	return texts;
}

/**
 * The text of each object, keyed by the name it was asked for (a blob id, or
 * `sha:path`), read in one `git cat-file --batch`. Names with a newline are
 * never sent, since the batch reads one name per line.
 */
export async function readObjects(cwd: string, objects: string[], signal: AbortSignal): Promise<Map<string, string>> {
	const wanted = objects.filter((object) => !object.includes('\n'));

	if (!wanted.length) return new Map();

	const proc = Bun.spawn(['git', 'cat-file', '--batch'], { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
	const abort = () => proc.kill();

	signal.addEventListener('abort', abort, { once: true });

	try {
		const output = new Response(proc.stdout).arrayBuffer();

		proc.stdin.write(wanted.map((object) => `${object}\n`).join(''));
		await proc.stdin.end();

		const bytes = new Uint8Array(await output);

		await proc.exited;

		return parseBatch(bytes, wanted);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}

/** The text of each path at `sha`. Callers pass paths from the repo inventory, so only regular files are read. */
export async function readFilesAt(
	cwd: string,
	sha: string,
	paths: string[],
	signal: AbortSignal
): Promise<Map<string, string>> {
	const texts = await readObjects(
		cwd,
		paths.map((path) => `${sha}:${path}`),
		signal
	);

	const found = new Map<string, string>();

	for (const path of paths) {
		const text = texts.get(`${sha}:${path}`);

		if (text !== undefined) found.set(path, text);
	}

	return found;
}
