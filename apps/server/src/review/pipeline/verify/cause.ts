import type { EvidenceRecord } from '../../../evidence/evidence.js';
import { FAILURE_LINE, runOutput } from './runs.js';

/** Why a run failed, as its output tells it: what a base comparison matches on instead of the exit code. */
export interface RunCause {
	/** Tests the runner reported failing, by name. */
	failed: string[];
	/** Tests the runner reported passing, by name. */
	passed: string[];
	/** The error and assertion lines, normalized. */
	errors: string[];
	/** For a failure that printed no error line: its first failure line, else its last line, normalized. */
	fallback: string | null;
	/** The first error or assertion line as printed. */
	failure: string | null;
	/** The first stack frame in the repo's code, as printed. */
	location: string | null;
	/** How many tests the runner says failed; null when it did not say. */
	failures: number | null;
}

/** Terminal colour codes, which differ between runs that print the same thing. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** The note a setup repair puts before the rerun's output (`harness/package-prep.ts`). */
const REPAIR_NOTE = /^\[Setup repaired: /;

/** A failing test as bun, vitest, jest, node:test and pytest report it. */
const FAILED_TEST =
	/^\s*(?:\(fail\)|FAIL(?:ED)?|[×✗✕✘●]|not ok \d+ -)\s+(.+?)(?:\s+\[[\d.]+\s*m?s\]|\s+\(?[\d.]+\s*m?s\)?)?\s*$/;

/** A passing test as bun, vitest, jest, node:test and pytest report it. */
const PASSED_TEST = /^\s*(?:\(pass\)|PASSED|[✓✔]|ok \d+ -)\s+(.+?)(?:\s+\[[\d.]+\s*m?s\]|\s+\(?[\d.]+\s*m?s\)?)?\s*$/;

/** A line that names an error or an assertion's values, but not a numbered line of a code frame. */
const ERROR_LINE =
	/^\s*(?!\d+\s*\|)(?:(?:Uncaught\s+)?[A-Z]\w*(?:Error|Exception)\b|error:|panic:|thread '.*' panicked|(?:Expected|Received|expected|received)\b|assert)/;

/** A `file:line[:col]` stack frame of a source file. */
const FRAME = /(?:^|[\s(❯@])((?:[\w.@+~-]*\/)*[\w.@+~-]+\.(?:[cm]?[jt]sx?|svelte|vue|py|go|rs)):(\d+)(?::(\d+))?/;

/** A frame outside the repo's own code. */
const FOREIGN_FRAME = /node_modules\/|^node:|internal\//;

/** A runner's count of failed tests (`3 fail`, `Tests  2 failed`, `1 failing`). */
const FAIL_COUNT = /(\d+)\s+(?:tests?\s+)?fail(?:ed|ing|ures?)?\b/gi;

/** Errors kept per run. */
const MAX_ERRORS = 12;

/**
 * A line as it would print on any checkout and any run: no colours,
 * durations, line and column numbers or long hex ids, and every absolute path
 * cut to its last two parts, since the base tree lives at another path.
 */
function normalize(line: string): string {
	return line
		.replace(/\[\d+(?:\.\d+)?\s*m?s\]|\(\d+(?:\.\d+)?\s*m?s\)|\b\d+(?:\.\d+)?\s*ms\b/g, '')
		.replace(/(?<![\w.@+~/-])\/[\w.@+~-][\w.@+~/-]*/g, (path) => path.split('/').slice(-2).join('/'))
		.replace(/(\.[a-z]{1,5}):\d+(?::\d+)?/g, '$1')
		.replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{12,}\b/gi, '#')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Each capture of `pattern` across `lines`, normalized, without repeats. */
function captures(lines: string[], pattern: RegExp): string[] {
	return [...new Set(lines.flatMap((line) => pattern.exec(line)?.[1] ?? []).map(normalize))];
}

/** The first frame in the repo's code. */
function firstFrame(lines: string[]): string | null {
	for (const line of lines) {
		const python = /File "([^"]+)", line (\d+)/.exec(line);

		if (python && !FOREIGN_FRAME.test(python[1]!)) return `${python[1]}:${python[2]}`;

		const frame = FRAME.exec(line);

		if (frame && !FOREIGN_FRAME.test(frame[1]!)) return frame[0].replace(/^[\s(❯@]/, '');
	}

	return null;
}

/** The largest failure count a runner printed. */
function failureCount(output: string): number | null {
	const counts = [...output.matchAll(FAIL_COUNT)].map((match) => Number(match[1]));

	return counts.length ? Math.max(...counts) : null;
}

/** What a recorded run's output says about why it failed; a run that passed has no errors. */
export function runCause(run: EvidenceRecord): RunCause {
	const output = runOutput(run).replace(ANSI, '');
	const lines = output.split('\n').filter((line) => line.trim() && !REPAIR_NOTE.test(line));
	const failedRun = typeof run.exitCode === 'number' && run.exitCode !== 0;
	const errorLines = failedRun ? lines.filter((line) => ERROR_LINE.test(line)) : [];

	const fallback =
		failedRun && !errorLines.length ? (lines.find((line) => FAILURE_LINE.test(line)) ?? lines.at(-1)) : undefined;

	return {
		failed: captures(lines, FAILED_TEST),
		passed: captures(lines, PASSED_TEST),
		errors: [...new Set(errorLines.map(normalize))].slice(0, MAX_ERRORS),
		fallback: fallback === undefined ? null : normalize(fallback),
		failure: (errorLines[0] ?? fallback)?.trim() ?? null,
		location: firstFrame(lines),
		failures: failureCount(output)
	};
}

/**
 * Whether `base` fails for the cause `head` does: every failing test and
 * error line the head printed is on the base too. A head failure that named
 * no test and printed no error line is matched by its fallback line anywhere
 * in the base's output.
 */
export function sameCause(head: RunCause, base: RunCause, baseOutput: string): boolean {
	const shows = (mine: string[], theirs: string[]) => mine.every((item) => theirs.includes(item));

	if (head.failed.length || head.errors.length)
		return shows(head.failed, base.failed) && shows(head.errors, base.errors);

	return head.fallback !== null && normalize(baseOutput.replace(ANSI, '')).includes(head.fallback);
}

/** Whether two runs' causes are the same: the same failing tests, errors, fallback line and failure count. */
export function sameCauses(a: RunCause, b: RunCause): boolean {
	const same = (x: string[], y: string[]) => x.length === y.length && x.every((item) => y.includes(item));

	return same(a.failed, b.failed) && same(a.errors, b.errors) && a.fallback === b.fallback && a.failures === b.failures;
}
