import type { SetupReport } from '../../../sandbox/workspace-setup.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';

/** The type check and lint scripts, in the order they run; the first type check found wins. */
const STATIC_SCRIPTS = [['typecheck', 'check'], ['lint']];

/** Script names worth running before review: the static checks, then the tests. */
const CHECK_SCRIPTS = [...STATIC_SCRIPTS, ['test']];

/** Package dirs safe to put in a shell command unquoted; any other dir is skipped. */
const PLAIN_DIR = /^[\w@][\w./@-]*$/;

/** JavaScript package managers the install may have used, by the command it ran. */
const JS_TOOLS = ['bun', 'pnpm', 'yarn', 'npm'];

/** Test runners that take path filters as arguments and accept `--passWithNoTests`. */
const FILTERING_RUNNER = /(?:^|\s)(?:vitest|vp test|jest)\b/;

/** Source files whose tests are worth picking; docs and config changes pick none. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;

/** Past this many filters the scoped run is no cheaper than the whole suite. */
const MAX_TEST_FILTERS = 8;

/** `dir: name → command` lines from `ExecWorkspace.scripts`, as a map of package dir to script name to command. */
function scriptsByDir(lines: string[]): Map<string, Map<string, string>> {
	const byDir = new Map<string, Map<string, string>>();

	for (const line of lines) {
		const match = /^(.+?): (\S+) → (.*)$/.exec(line);

		if (!match) continue;

		const [, dir, name, command] = match;

		byDir.set(dir, (byDir.get(dir) ?? new Map()).set(name, command));
	}

	return byDir;
}

/** The package that owns `path`: the deepest package dir that contains it, `.` for the root. */
function owningDir(path: string, dirs: string[]): string | null {
	const owners = dirs.filter((dir) => dir === '.' || path.startsWith(`${dir}/`));

	return owners.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** The JavaScript package manager the install ran with, or null when nothing JavaScript was installed. */
function installedTool(setup: SetupReport | null): string | null {
	const first = setup?.steps.find((step) => JS_TOOLS.includes(step.command.split(' ')[0]));

	return first ? first.command.split(' ')[0] : null;
}

/**
 * Path filters that pick the tests near the changed files: each file's folder
 * inside the package without its top folder, so `src/rate-limit/store.ts`
 * matches both `src/rate-limit/store.test.ts` and `tests/rate-limit/store.test.ts`.
 * Null when a code file sits too high up to narrow the run, or there are too many.
 */
function testFilters(dir: string, paths: string[]): string[] | null {
	const filters = new Set<string>();

	for (const path of paths.filter((entry) => CODE_FILE.test(entry))) {
		const inner = dir === '.' ? path : path.slice(dir.length + 1);
		const folder = inner.split('/').slice(1, -1).join('/');

		if (!folder || !PLAIN_DIR.test(folder)) return null;

		filters.add(`${folder}/`);
	}

	return filters.size > 0 && filters.size <= MAX_TEST_FILTERS ? [...filters].sort() : null;
}

/**
 * The run command for one script. A test script whose runner takes path
 * filters runs only the tests near the changed files; a whole suite can take
 * longer than the review.
 */
function scriptCommand(tool: string, name: string, script: string, paths: string[], dir: string): string {
	const run = `${tool} run ${name}`;
	const filters = name === 'test' && FILTERING_RUNNER.test(script) ? testFilters(dir, paths) : null;

	if (!filters) return run;

	return `${run} ${tool === 'npm' ? '-- ' : ''}${filters.join(' ')} --passWithNoTests`;
}

/**
 * The `choices` scripts of every package that owns one of `paths`, from its
 * own `package.json`, run with the tool the install used. Packages run in path order.
 */
function ownedChecks(scripts: string[], paths: string[], setup: SetupReport | null, choices: string[][]): string[] {
	const tool = installedTool(setup);

	if (!tool) return [];

	const byDir = scriptsByDir(scripts);
	const dirs = [...byDir.keys()].filter((dir) => dir === '.' || PLAIN_DIR.test(dir));
	const owned = new Map<string, string[]>();

	for (const path of paths) {
		const dir = owningDir(path, dirs);

		if (dir !== null) owned.set(dir, [...(owned.get(dir) ?? []), path]);
	}

	return [...owned.keys()].sort().flatMap((dir) => {
		const named = byDir.get(dir)!;

		return choices
			.flatMap((options) => options.find((name) => named.has(name)) ?? [])
			.map((name) => scriptCommand(tool, name, named.get(name)!, owned.get(dir)!, dir))
			.map((command) => (dir === '.' ? command : `cd ${dir} && ${command}`));
	});
}

/**
 * The checks to run on the PR head before review, picked without a model:
 * the type check, lint and tests of every package that owns a changed file.
 * The list stops at `maxBaselineChecks`.
 */
export function pickBaselineChecks(scripts: string[], changedPaths: string[], setup: SetupReport | null): string[] {
	return ownedChecks(scripts, changedPaths, setup, CHECK_SCRIPTS).slice(0, REVIEW_POLICY.maxBaselineChecks);
}

/** The type check and lint of every package that owns a file a suggested patch edits. */
export function pickPatchChecks(scripts: string[], paths: string[], setup: SetupReport | null): string[] {
	return ownedChecks(scripts, paths, setup, STATIC_SCRIPTS);
}
