import type { SetupReport } from '../../../sandbox/exec-workspace.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';

/** Script names worth running before review, in the order they run; the first type check found wins. */
const CHECK_SCRIPTS = [['typecheck', 'check'], ['lint'], ['test']];

/** Package dirs safe to put in a shell command unquoted; any other dir is skipped. */
const PLAIN_DIR = /^[\w@][\w./@-]*$/;

/** JavaScript package managers the install may have used, by the command it ran. */
const JS_TOOLS = ['bun', 'pnpm', 'yarn', 'npm'];

/** `dir: name → command` lines from `ExecWorkspace.scripts`, as a map of package dir to script names. */
function scriptsByDir(lines: string[]): Map<string, Set<string>> {
	const byDir = new Map<string, Set<string>>();

	for (const line of lines) {
		const match = /^(.+?): (\S+) → /.exec(line);

		if (!match) continue;

		const [, dir, name] = match;

		byDir.set(dir, (byDir.get(dir) ?? new Set()).add(name));
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
 * The checks to run on the PR head before review, picked without a model:
 * the type check, lint and tests of every package that owns a changed file,
 * from its own `package.json` scripts. Packages run in path order and the
 * list stops at `maxBaselineChecks`.
 */
export function pickBaselineChecks(scripts: string[], changedPaths: string[], setup: SetupReport | null): string[] {
	const tool = installedTool(setup);

	if (!tool) return [];

	const byDir = scriptsByDir(scripts);
	const dirs = [...byDir.keys()].filter((dir) => dir === '.' || PLAIN_DIR.test(dir));

	const owners = [...new Set(changedPaths.map((path) => owningDir(path, dirs)))]
		.filter((dir): dir is string => dir !== null)
		.sort();

	const commands = owners.flatMap((dir) => {
		const names = byDir.get(dir)!;

		return CHECK_SCRIPTS.flatMap((choices) => choices.find((name) => names.has(name)) ?? []).map((name) =>
			dir === '.' ? `${tool} run ${name}` : `cd ${dir} && ${tool} run ${name}`
		);
	});

	return commands.slice(0, REVIEW_POLICY.maxBaselineChecks);
}
