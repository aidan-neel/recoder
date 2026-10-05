import { posix } from 'node:path';

/** Paths safe to put in a shell command unquoted. */
const PLAIN_PATH = /^[\w@][\w./@-]*$/;

/** The test file with `.recoder-old` before its `.test` or `.spec` marker, beside the file so its imports still resolve. */
export function oldCopyPath(path: string): string {
	return path.replace(/(\.(?:test|spec))?(\.[^./]+)$/, '.recoder-old$1$2');
}

/** `dir: test → command`, a line of the workspace's script listing. */
const TEST_SCRIPT = /^(.+?): test → (.*)$/;

/** The package manager a baseline command ran with. */
const TOOL = /(?:^|&& )(bun|pnpm|yarn|npm) run /;

/** Runners that take a test file path as an argument. */
const FILE_RUNNER = /^(?:ava|vitest|vp test|jest|bun test)\b/;

/** The command that runs a binary the install put in a package. */
const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' } as const;

/** The nearest package dir above a path that has a test script. */
function owningScript(scripts: Map<string, string>, path: string): { dir: string; script: string } | null {
	const dirs = [...scripts.keys()].filter((dir) => dir === '.' || path.startsWith(`${dir}/`));
	const dir = dirs.sort((a, b) => b.length - a.length)[0];

	return dir === undefined ? null : { dir, script: scripts.get(dir)! };
}

/**
 * Runs one test file through the runner a package's test script ends with:
 * the last step of `xo && tsc && ava` is `ava`, and that step takes a path.
 * Built from the workspace's script listing and the package manager the
 * baseline checks used. Null for a file with no such package or runner, or a
 * path that is not plain.
 */
export function singleFileCommands(scriptLines: readonly string[], baselineCommands: readonly string[]) {
	const scripts = new Map<string, string>();

	for (const line of scriptLines) {
		const match = TEST_SCRIPT.exec(line);

		if (match) scripts.set(match[1]!, match[2]!);
	}

	const tool = baselineCommands.map((command) => TOOL.exec(command)?.[1]).find(Boolean) as
		keyof typeof EXEC | undefined;

	return (path: string): string | null => {
		const owner = PLAIN_PATH.test(path) ? owningScript(scripts, path) : null;

		if (!owner || (owner.dir !== '.' && !PLAIN_PATH.test(owner.dir))) return null;

		const step = owner.script.split('&&').pop()!.trim();

		if (!FILE_RUNNER.test(step)) return null;

		const inner = owner.dir === '.' ? path : path.slice(owner.dir.length + 1);
		const prefix = step.startsWith('bun test') ? '' : tool ? `${EXEC[tool]} ` : null;

		if (prefix === null) return null;

		const run = `${prefix}${step} ${posix.normalize(inner)}`;

		return owner.dir === '.' ? run : `cd ${owner.dir} && ${run}`;
	};
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
