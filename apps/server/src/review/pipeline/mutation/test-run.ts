import { posix } from 'node:path';
import { REVIEW_POLICY } from '../../session/review-policy.js';

/** Paths safe to put in a shell command unquoted. */
export const PLAIN_PATH = /^[\w@][\w./@-]*$/;

/** The exit code a matrix command uses when the mutated file could not be written, so the run is no evidence. */
export const WRITE_FAILED_EXIT = 97;

/** A file the matrix has the workspace place for one run: written through the scratch channel and removed after it. */
interface MatrixFile {
	path: string;
	text: string;
}

/** One sandbox run: the shell command plus the files placed for it. */
export interface CommandPlan {
	command: string;
	files: MatrixFile[];
}

/** Why a mutant's files cannot become one sandbox run. */
export type CommandSkip = 'unsafe-path' | 'too-large';

/** The test file with `.recoder-old` before its `.test` or `.spec` marker, beside the file so its imports still resolve. */
export function oldCopyPath(path: string): string {
	return path.replace(/(\.(?:test|spec))?(\.[^./]+)$/, '.recoder-old$1$2');
}

/** `dir: name → command`, a line of the workspace's script listing. */
const SCRIPT_LINE = /^(.+?): ([\w:.-]+) → (.*)$/;

/** A step that only runs another script of the package. */
const SCRIPT_STEP = /^(?:bun|pnpm|npm|yarn) run ([\w:.-]+)$/;

/** The package manager a baseline command ran with. */
const TOOL = /(?:^|&& )(bun|pnpm|yarn|npm) run /;

/** Runners that take a test file path as an argument. */
const FILE_RUNNER = /^(?:ava|vitest|vp test|jest|bun test)\b/;

/** A name or folder that marks a file a runner's default globs pick up: `.test.`, `.spec.`, `_test.` or a `__tests__/` folder. */
const MARKED_TEST_FILE = /(?:(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/[^/]+\.[cm]?[jt]sx?$)/;

/** AVA's default globs also take any file under a `test/` folder, except its helpers and fixtures. */
const AVA_TEST_FOLDER = /(?:^|\/)test\/(?!(?:.*\/)?(?:helpers?|fixtures?|_[^/]*)\/)(?:.*\/)?[^/_][^/]*\.[cm]?[jt]sx?$/;

/** Whether a runner's default globs run `path` on its own; a helper in a tests folder is not a test. */
function runsAlone(step: string, path: string): boolean {
	return MARKED_TEST_FILE.test(path) || (step.startsWith('ava') && AVA_TEST_FOLDER.test(path));
}

/** The command that runs a binary the install put in a package. */
export const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' } as const;

/** The nearest package dir above a path that has a test script. */
function owningScript(scripts: Map<string, Map<string, string>>, path: string): { dir: string; script: string } | null {
	const dirs = [...scripts.keys()].filter((dir) => dir === '.' || path.startsWith(`${dir}/`));
	const dir = dirs.filter((candidate) => scripts.get(candidate)!.has('test')).sort((a, b) => b.length - a.length)[0];

	return dir === undefined ? null : { dir, script: testChain(scripts.get(dir)!).runner };
}

/**
 * The scripts a test script runs before its runner, and the runner step: the
 * last `&&` step, following a step that only runs another script. `bun run
 * build:registry && bun test` runs `build:registry` first, then `bun test`.
 */
export function testChain(
	scripts: Map<string, string>,
	name = 'test',
	depth = 0
): { before: string[]; runner: string } {
	const steps = (scripts.get(name) ?? '')
		.split('&&')
		.map((step) => step.trim())
		.filter(Boolean);

	const last = steps.pop() ?? '';
	const before = steps.flatMap((step) => SCRIPT_STEP.exec(step)?.[1] ?? []);
	const next = SCRIPT_STEP.exec(last)?.[1];

	if (!next || depth >= 3 || !scripts.has(next)) return { before, runner: last };

	const inner = testChain(scripts, next, depth + 1);

	return { before: [...before, ...inner.before], runner: inner.runner };
}

/**
 * Runs one test file through the runner a package's test script ends with:
 * the last step of `xo && tsc && ava` is `ava`, and that step takes a path.
 * Built from the workspace's script listing and the package manager the
 * baseline checks used. Null for a file with no such package or runner, or a
 * path that is not plain.
 */
export function singleFileCommands(scriptLines: readonly string[], baselineCommands: readonly string[]) {
	const scripts = new Map<string, Map<string, string>>();

	for (const line of scriptLines) {
		const match = SCRIPT_LINE.exec(line);

		if (match) scripts.set(match[1]!, (scripts.get(match[1]!) ?? new Map()).set(match[2]!, match[3]!));
	}

	const tool = baselineCommands.map((command) => TOOL.exec(command)?.[1]).find(Boolean) as
		keyof typeof EXEC | undefined;

	return (path: string): string | null => {
		const owner = PLAIN_PATH.test(path) ? owningScript(scripts, path) : null;

		if (!owner || (owner.dir !== '.' && !PLAIN_PATH.test(owner.dir))) return null;

		const step = owner.script;

		if (!FILE_RUNNER.test(step)) return null;
		if (!runsAlone(step, path)) return null;

		const inner = owner.dir === '.' ? path : path.slice(owner.dir.length + 1);
		const prefix = step.startsWith('bun test') ? '' : tool ? `${EXEC[tool]} ` : null;

		if (prefix === null) return null;

		const quiet = /^(?:vitest|vp test)\b/.test(step) ? ' --reporter=dot --coverage.enabled=false' : '';
		const run = `${prefix}${step}${quiet} ${posix.normalize(inner)}`;

		return owner.dir === '.' ? run : `cd ${owner.dir} && ${run}`;
	};
}

/** Scratch prefix for a mutated file's chunks: placed for the run, removed after, and never matched by a test glob. */
const MUTANT_SCRATCH = '.recoder-mutant';

/** Characters per scratch file, under the workspace's per-file write limit with room to spare. */
const CHUNK_CHARS = 60_000;

/** Chunks a payload may take; a bigger file is too large for the matrix. */
const MAX_CHUNKS = 8;

/** The scratch files a payload is split into, or null past the chunk cap. A chunk never ends inside a surrogate pair, so the pieces concatenate back to the text. */
function payloadChunks(text: string): MatrixFile[] | null {
	const chunks: MatrixFile[] = [];
	let rest = text;

	while (rest.length) {
		let size = Math.min(CHUNK_CHARS, rest.length);
		const last = rest.charCodeAt(size - 1);

		if (size < rest.length && last >= 0xd800 && last <= 0xdbff) size--;

		chunks.push({ path: `${MUTANT_SCRATCH}.${chunks.length}`, text: rest.slice(0, size) });
		rest = rest.slice(size);
	}

	if (!chunks.length) chunks.push({ path: `${MUTANT_SCRATCH}.0`, text: '' });

	return chunks.length > MAX_CHUNKS ? null : chunks;
}

/**
 * One run: the mutated source lands through scratch chunks `cat`ed onto the
 * tracked path, the old test through a scratch file at its `.recoder-old`
 * path, then the tests run and their exit code stands. The workspace places
 * every file for the run and removes it after, so a killed or timed-out run
 * leaves nothing behind, and the payload never reaches the command line.
 * `unsafe-path` for a path that is not plain, `too-large` past the caps.
 */
export function mutantCommand(input: {
	source: { path: string; text: string } | null;
	oldTest: { path: string; text: string } | null;
	run: string;
}): CommandPlan | CommandSkip {
	const { source, oldTest, run } = input;
	const files: MatrixFile[] = [];
	let write = '';

	if (source) {
		if (!PLAIN_PATH.test(source.path)) return 'unsafe-path';

		const chunks = payloadChunks(source.text);

		if (!chunks) return 'too-large';

		files.push(...chunks);
		write = `cat -- ${chunks.map((chunk) => chunk.path).join(' ')} > ${source.path} || exit ${WRITE_FAILED_EXIT}; `;
	}

	if (oldTest) {
		if (!PLAIN_PATH.test(oldTest.path)) return 'unsafe-path';
		if (oldTest.text.length > REVIEW_POLICY.maxWriteFileChars) return 'too-large';

		files.push({ path: oldTest.path, text: oldTest.text });
	}

	return { command: `${write}( ${run} ); rc=$?; exit $rc`, files };
}
