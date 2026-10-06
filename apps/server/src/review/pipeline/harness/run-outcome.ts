import type { RunResult } from '../../../sandbox/exec-sandbox.js';
import type { ExecutionOutcome } from '../../../evidence/types.js';
import { owningDir } from './baseline-checks.js';
import { bareStep, stepRunner, type ExecutionProfile, type TestRunner, type Transform } from './exec-profile.js';

/** Output of a run that stopped before the code under test ran: a missing module, binary or test file. */
export const SETUP_FAILURE =
	/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|Module not found|Could not resolve|command not found|No test files found/;

/** More output of a run that never reached its assertion: an import a bundler could not load, or a script that does not exist. */
const SETUP_STOPPED =
	/Failed to (?:resolve import|load url)|error: Script not found|Missing script:|could not determine executable to run/;

/** What a runtime prints when it meets code that needed a transform it never applied. */
const UNTRANSFORMED: Record<Transform['name'], RegExp> = {
	svelte:
		/\$(?:state|derived|effect|props|bindable|inspect|host)\b(?:\.\w+)? is not defined|rune_outside_svelte|lifecycle_function_unavailable|Unknown file extension "\.svelte"/,
	vue: /Unknown file extension "\.vue"/
};

/** Files only a transform can run. */
const TRANSFORMED_FILE: Record<Transform['name'], RegExp> = {
	svelte: /\S+\.svelte(?:\.[cm]?[jt]s)?(?=\s|$|['"])/,
	vue: /\S+\.vue(?=\s|$|['"])/
};

/** A runtime on a file or inline code: these apply no transform of their own. */
const RUNTIME_STEP =
	/^(?:(bun|node)(?:\s+run)?\s+(?:--?[\w-]+(?:=\S+)?\s+)*(?:-e|-p|--eval|--print|\S+\.(?:[cm]?[jt]sx?|svelte|vue))(?=\s|$)|(tsx|ts-node)\s+\S|(deno)\s+(?:run|eval|test)\b|(python3?)\s+\S)/;

/** A package's test script, which runs the profile's runner. */
const TEST_SCRIPT_STEP = /^(?:(?:bun|pnpm|npm|yarn)\s+(?:run\s+)?test(?::[\w:.-]+)?|npm\s+t)(?=\s|$)/;

/** What runs code in a command: a test runner, or a bare runtime that applies no transform. */
type Executor = TestRunner | 'bun' | 'node' | 'other';

/** The last step of `command` that runs code, with what runs it; null for a command that only reads, builds or lists. */
function executor(command: string, profile: ExecutionProfile | null): { by: Executor | null; step: string } | null {
	const steps = command.split(/&&|\|\||;|\|/).map((step) => step.trim());

	for (const step of steps.reverse()) {
		const runner = stepRunner(step);

		if (runner) return { by: runner, step };
		if (TEST_SCRIPT_STEP.test(step)) return { by: profile?.runner ?? null, step };

		const runtime = RUNTIME_STEP.exec(bareStep(step));

		if (runtime) return { by: runtime[1] === 'bun' ? 'bun' : runtime[1] || runtime[2] ? 'node' : 'other', step };
	}

	return null;
}

/**
 * What a run of `command` reached, read against its package's profile, or
 * undefined for a command that runs no test or code, and for one that timed
 * out or was killed. A run that passed reached its assertion. A failure is
 * unsupported execution when the package needs a transform this executor
 * never applies (a `.svelte` file through bare `bun`) and the run shows it,
 * setup-failed when it never got past a missing module, script or binary,
 * and otherwise a failed assertion.
 */
export function classifyRun(
	command: string,
	result: Pick<RunResult, 'exitCode' | 'output' | 'timedOut'>,
	profile: ExecutionProfile | null
): ExecutionOutcome | undefined {
	if (result.timedOut || result.exitCode === null) return undefined;

	const found = executor(command, profile);

	if (!found) return undefined;
	if (result.exitCode === 0) return 'assertion-passed';

	const bare = found.by === 'bun' || found.by === 'node';

	const untransformed = (profile?.transforms ?? []).some(
		(transform) =>
			!(transform.via as string[]).includes(found.by ?? '') &&
			(UNTRANSFORMED[transform.name].test(result.output) || (bare && TRANSFORMED_FILE[transform.name].test(found.step)))
	);

	if (untransformed) return 'unsupported-execution';
	if (SETUP_FAILURE.test(result.output) || SETUP_STOPPED.test(result.output)) return 'setup-failed';

	return 'assertion-failed';
}

/** An outcome that settles nothing about the code: the run never reached an assertion. */
export function unresolved(outcome: ExecutionOutcome | undefined): boolean {
	return outcome === 'setup-failed' || outcome === 'unsupported-execution';
}

/** The package `command` runs in: the dir it changes into, else the owner of the first code path it names, else the root. */
export function commandPackage(command: string, dirs: string[]): string | null {
	const into = /^\s*cd\s+([\w./@-]+)\s*&&/.exec(command)?.[1]?.replace(/^\.\//, '').replace(/\/+$/, '');

	if (into) return dirs.includes(into) ? into : owningDir(`${into}/x`, dirs);

	const path = command
		.split(/[\s'"=]+/)
		.map((token) => token.replace(/^\.\//, ''))
		.find((token) => /^[\w@][\w./@-]*\.(?:[cm]?[jt]sx?|svelte|vue)$/.test(token));

	return (path && owningDir(path, dirs)) ?? (dirs.includes('.') ? '.' : null);
}
