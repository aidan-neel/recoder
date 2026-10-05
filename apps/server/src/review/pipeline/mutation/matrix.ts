import type { RunResult } from '../../../sandbox/exec-sandbox.js';
import { isTestPath, testStem } from '../change-model/test-files.js';
import type { AddedLines } from '../detectors/changed-lines.js';
import type { TestFileVersions } from '../detectors/test-files.js';
import type { DetectorResult } from '../detectors/types.js';
import { mutantsOf, type Mutant } from './mutants.js';
import { mutantCommand, oldCopyPath, singleFileCommand } from './test-run.js';

/** Time one test run may take in the matrix. */
const RUN_TIMEOUT_MS = 90_000;

/** Time all of one review's matrix runs may take together. */
export const MATRIX_BUDGET_MS = 6 * 60_000;

/** Runs one shell command in the sandbox on the PR head. */
export type Runner = (command: string, timeoutMs: number) => Promise<RunResult>;

/** What the matrix gives up on, with the reason a log line can state. */
export interface MatrixOutcome {
	results: DetectorResult[];
	runs: number;
	skipped?: string;
}

/** A run that finished, passed or failed; a timeout or a kill says nothing about the tests. */
function verdict(result: RunResult): 'pass' | 'fail' | null {
	if (result.timedOut || result.exitCode === null) return null;

	return result.exitCode === 0 ? 'pass' : 'fail';
}

/** The changed source file a test file is about: the one that shares its stem. */
function sourceFor(test: string, changedSources: Map<string, string>): string | null {
	const stem = testStem(test);

	return [...changedSources.keys()].find((path) => testStem(path) === stem && !isTestPath(path)) ?? null;
}

/** The first line of the test file that the change adds and that asserts something. */
function anchorLine(file: TestFileVersions): number {
	const lines = file.head.split('\n');
	const added = [...file.added].sort((a, b) => a - b);

	return added.find((line) => /\b(?:expect|assert|t\.\w+)\b/.test(lines[line - 1] ?? '')) ?? added[0] ?? 1;
}

function resultFor(file: TestFileVersions, mutant: Mutant, evidence: string): DetectorResult {
	return {
		detector: 'mutation',
		category: 'tests',
		title: 'Edited test no longer catches a fault the old one did',
		body: `With \`${mutant.file}\` changed to ${mutant.description}, the old version of \`${file.path}\` fails and the edited version still passes. The edit removed a check the suite relied on to tell this behavior from a broken one.`,
		file: file.path,
		line: anchorLine(file),
		ruleId: 'mutant-survives-edited-test',
		evidence
	};
}

/**
 * The old/new matrix for one edited test file: on the PR's code the old and
 * new file both pass; then, for each mutant of the source the change adds,
 * the old file fails and the new passes. That row is a finding, proven by the
 * runs. Any other row, and any run that did not finish, is none.
 */
async function fileMatrix(input: {
	file: TestFileVersions;
	source: { path: string; head: string };
	command: string;
	added: AddedLines;
	run: Runner;
	remaining: () => number;
}): Promise<{ results: DetectorResult[]; runs: number }> {
	const { file, source, command, added, run, remaining } = input;
	const oldTest = { path: oldCopyPath(file.path), text: file.base };
	const oldCommand = singleFileCommand([command], oldTest.path) ?? command;
	let runs = 0;

	const execute = async (cmd: string): Promise<'pass' | 'fail' | null> => {
		if (remaining() <= 0) return null;

		runs++;

		return verdict(await run(cmd, Math.min(RUN_TIMEOUT_MS, remaining())));
	};

	const [newOk, oldOk] = [
		await execute(mutantCommand({ source: null, oldTest: null, run: command })),
		await execute(mutantCommand({ source: null, oldTest, run: oldCommand }))
	];

	if (newOk !== 'pass' || oldOk !== 'pass') return { results: [], runs };

	for (const mutant of mutantsOf(source.path, source.head, added)) {
		const text = { path: source.path, text: mutant.text };
		const newRun = await execute(mutantCommand({ source: text, oldTest: null, run: command }));

		if (newRun !== 'pass') continue;

		const oldRun = await execute(mutantCommand({ source: text, oldTest, run: oldCommand }));

		if (oldRun === 'fail') {
			const evidence = `mutant "${mutant.description}" in ${mutant.file}: old ${oldTest.path} failed, edited ${file.path} passed (${command})`;

			return { results: [resultFor(file, mutant, evidence)], runs };
		}
	}

	return { results: [], runs };
}

/**
 * Runs the test matrix on every edited test file whose source file the PR
 * also changed. One finding per test file at most. Skips quietly, with the
 * reason, when no baseline test command can run a single file.
 */
export async function testMatrix(input: {
	tests: TestFileVersions[];
	sources: Map<string, string>;
	added: AddedLines;
	baselineCommands: string[];
	run: Runner;
	deadline: number;
}): Promise<MatrixOutcome> {
	const { tests, sources, added, baselineCommands, run, deadline } = input;
	const edited = tests.filter((file) => file.base && file.base !== file.head);
	const results: DetectorResult[] = [];
	let runs = 0;

	for (const file of edited) {
		const sourcePath = sourceFor(file.path, sources);
		const command = singleFileCommand(baselineCommands, file.path);

		if (!sourcePath || !command) continue;

		const done = await fileMatrix({
			file,
			source: { path: sourcePath, head: sources.get(sourcePath)! },
			command,
			added,
			run,
			remaining: () => deadline - Date.now()
		});

		results.push(...done.results);
		runs += done.runs;
	}

	return {
		results,
		runs,
		...(edited.length && !runs ? { skipped: 'no edited test had a source file and a test command' } : {})
	};
}
