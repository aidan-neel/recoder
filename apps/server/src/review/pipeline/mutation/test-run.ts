import { posix } from 'node:path';

/** Paths safe to put in a shell command unquoted. */
const PLAIN_PATH = /^[\w@][\w./@-]*$/;

/** `cd dir && tool run test …`, the shape the baseline check gives a package's test script. */
const TEST_COMMAND = /^(?:cd ([^\s&;|]+) && )?(bun|pnpm|yarn|npm) run test\b/;

/** The test file with `.recoder-old` before its `.test` or `.spec` marker, beside the file so its imports still resolve. */
export function oldCopyPath(path: string): string {
	return path.replace(/(\.(?:test|spec))?(\.[^./]+)$/, '.recoder-old$1$2');
}

/**
 * A command that runs one test file in the package whose test script a
 * baseline check ran, or null when no baseline test command owns the file or
 * the path is not plain.
 */
export function singleFileCommand(baselineCommands: readonly string[], path: string): string | null {
	if (!PLAIN_PATH.test(path)) return null;

	for (const command of baselineCommands) {
		const match = TEST_COMMAND.exec(command);

		if (!match) continue;

		const dir = match[1] ?? '.';

		if (dir !== '.' && !path.startsWith(`${dir}/`)) continue;

		const inner = dir === '.' ? path : path.slice(dir.length + 1);
		const run = `${match[2]} run test ${match[2] === 'npm' ? '-- ' : ''}${posix.normalize(inner)}`;

		return dir === '.' ? run : `cd ${dir} && ${run}`;
	}

	return null;
}

/** A shell step that writes `text` to a repo path, so the file needs no tracked-path scratch write. */
function writeStep(path: string, text: string): string {
	return `mkdir -p -- ${posix.dirname(path)} && printf %s '${Buffer.from(text).toString('base64')}' | base64 -d > ${path}`;
}

/**
 * One command: write the mutated source (and the old test, when given), run
 * the tests in a subshell, delete the old copy and keep the tests' exit code.
 */
export function mutantCommand(input: {
	source: { path: string; text: string } | null;
	oldTest: { path: string; text: string } | null;
	run: string;
}): string {
	const { source, oldTest, run } = input;
	const steps = [source, oldTest].flatMap((file) => (file ? [writeStep(file.path, file.text)] : []));
	const cleanup = oldTest ? `rm -f -- ${oldTest.path}; ` : '';

	return `${steps.join(' && ')}${steps.length ? '; ' : ''}( ${run} ); rc=$?; ${cleanup}exit $rc`;
}
