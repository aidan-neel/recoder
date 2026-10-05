import type { RunResult } from '../../../sandbox/exec-sandbox.js';
import { isTestPath, testStem } from '../change-model/test-files.js';
import type { AddedLines } from '../detectors/changed-lines.js';
import type { TestFileVersions } from '../detectors/test-files.js';
import type { DetectorResult } from '../detectors/types.js';
import { aimedMutants } from './aim.js';
import { mutantsOf, probeOf, type Mutant } from './mutants.js';
import { mutantCommand, oldCopyPath } from './test-run.js';

/** Time one test run may take in the matrix. */
const RUN_TIMEOUT_MS = 45_000;

/** Time all of one review's matrix runs may take together. */
export const MATRIX_BUDGET_MS = 2 * 60_000;

/** Mutants tried per edited test file against its old version, at most. */
const MAX_OLD_NEW_MUTANTS = 6;

/** Why the matrix did not run or prove something, fixed so an eval can count them. */
export type SkipReason =
	| 'no-suspicion'
	| 'no-sandbox'
	| 'no-single-file-command'
	| 'sanity-failed'
	| 'no-aimed-mutant'
	| 'unreachable'
	| 'budget';

/** What one review's matrix did, for its task row and the benchmark report. */
export interface MatrixCounts {
	suspicions: number;
	files: number;
	sanityPassed: number;
	probes: number;
	mutants: number;
	killed: number;
	survivors: number;
	findings: number;
	runs: number;
	ms: number;
	skips: Partial<Record<SkipReason, number>>;
	/** The head of the output of the first sanity run that failed. */
	sanityOutput?: string;
}

/** The matrix's findings and what it did to reach them. */
export interface MatrixOutcome {
	results: DetectorResult[];
	counts: MatrixCounts;
}

/** Runs one shell command in the sandbox on the PR head. */
export type Runner = (command: string, timeoutMs: number) => Promise<RunResult>;

type Source = { path: string; head: string };

export function emptyCounts(): MatrixCounts {
	return {
		suspicions: 0,
		files: 0,
		sanityPassed: 0,
		probes: 0,
		mutants: 0,
		killed: 0,
		survivors: 0,
		findings: 0,
		runs: 0,
		ms: 0,
		skips: {}
	};
}

/** A run that finished, passed or failed; a timeout or a kill says nothing about the tests. */
function verdict(result: RunResult): 'pass' | 'fail' | null {
	if (result.timedOut || result.exitCode === null) return null;

	return result.exitCode === 0 ? 'pass' : 'fail';
}

/** The runs of one review, counted and bounded by the matrix budget. */
class Session {
	readonly counts = emptyCounts();
	private readonly started = Date.now();

	constructor(
		private readonly runner: Runner,
		private readonly deadline: number
	) {}

	remaining(): number {
		return this.deadline - Date.now();
	}

	skip(reason: SkipReason): void {
		this.counts.skips[reason] = (this.counts.skips[reason] ?? 0) + 1;
	}

	/** One run; null, and a `budget` skip, when the budget is gone or the run did not finish. */
	async run(command: string): Promise<{ verdict: 'pass' | 'fail'; output: string } | null> {
		if (this.remaining() <= 0) {
			this.skip('budget');

			return null;
		}

		this.counts.runs++;

		const result = await this.runner(command, Math.min(RUN_TIMEOUT_MS, this.remaining()));
		const done = verdict(result);

		this.counts.ms = Date.now() - this.started;

		return done ? { verdict: done, output: result.output } : null;
	}
}

/**
 * The changed source files a test may be about, most likely first: those the
 * test names in an import, then those that share its stem, then the rest.
 */
function sourcesFor(file: TestFileVersions, changedSources: Map<string, string>): Source[] {
	const stem = testStem(file.path);

	const rank = (path: string): number => {
		const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

		if (new RegExp(`from\\s+['"][^'"]*/${name}(?:\\.[cm]?[jt]sx?)?['"]`).test(file.head)) return 0;

		return testStem(path) === stem ? 1 : 2;
	};

	return [...changedSources]
		.filter(([path]) => !isTestPath(path))
		.map(([path, head]) => ({ path, head }))
		.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

/** The first line of the test file that the change adds and that asserts something. */
function anchorLine(file: TestFileVersions): number {
	const lines = file.head.split('\n');
	const added = [...file.added].sort((a, b) => a - b);

	return added.find((line) => /\b(?:expect|assert|t\.\w+)\b/.test(lines[line - 1] ?? '')) ?? added[0] ?? 1;
}

/** The edited file's old version failing on a mutant the edited one passes: a finding the runs prove. */
function editedResult(file: TestFileVersions, mutant: Mutant, evidence: string): DetectorResult {
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

/** A suspicion the runs proved: the test passes with the code broken as the weak assertion permits. */
function provenResult(suspicion: DetectorResult, mutant: Mutant, evidence: string): DetectorResult {
	return {
		detector: 'mutation',
		category: 'tests',
		title: suspicion.title,
		body: `${suspicion.body} Proof: this test file still passes when \`${mutant.file}\` is changed to ${mutant.description}, and a probe on that line shows the test reaches it.`,
		file: suspicion.file,
		line: suspicion.line,
		endLine: suspicion.endLine,
		evidence
	};
}

/**
 * The old/new matrix for one edited test file: the old file passes on the
 * PR's code, then for each mutant of the source the change adds, the old
 * file fails and the edited one passes.
 */
async function oldNewRow(input: {
	session: Session;
	file: TestFileVersions;
	sources: Source[];
	commands: { head: string; old: string };
	added: AddedLines;
}): Promise<DetectorResult | null> {
	const { session, file, sources, commands, added } = input;
	const oldTest = { path: oldCopyPath(file.path), text: file.base };
	const oldSanity = await session.run(mutantCommand({ source: null, oldTest, run: commands.old }));

	if (oldSanity?.verdict !== 'pass') return null;

	const mutants = sources.flatMap((source) => mutantsOf(source.path, source.head, added)).slice(0, MAX_OLD_NEW_MUTANTS);

	for (const mutant of mutants) {
		const source = { path: mutant.file, text: mutant.text };

		session.counts.mutants++;

		if ((await session.run(mutantCommand({ source, oldTest: null, run: commands.head })))?.verdict !== 'pass') {
			session.counts.killed++;

			continue;
		}

		session.counts.survivors++;

		if ((await session.run(mutantCommand({ source, oldTest, run: commands.old })))?.verdict === 'fail') {
			return editedResult(
				file,
				mutant,
				`mutant "${mutant.description}" in ${mutant.file}: old ${oldTest.path} failed, edited ${file.path} passed (${commands.head})`
			);
		}
	}

	return null;
}

/**
 * A detector's suspicion proved by the runs: an aimed mutant the whole test
 * file passes, on a line a probe shows the test reaches. A mutant another
 * assertion kills, or on a line no test reaches, proves nothing.
 */
async function suspicionRow(input: {
	session: Session;
	file: TestFileVersions;
	suspicion: DetectorResult;
	sources: Source[];
	command: string;
}): Promise<DetectorResult | null> {
	const { session, file, suspicion, sources, command } = input;
	const mutants = aimedMutants(suspicion, file.head, sources);

	if (!mutants.length) {
		session.skip('no-aimed-mutant');

		return null;
	}

	let survived = false;

	for (const mutant of mutants) {
		session.counts.mutants++;

		const outcome = await session.run(
			mutantCommand({ source: { path: mutant.file, text: mutant.text }, oldTest: null, run: command })
		);

		if (outcome?.verdict !== 'pass') {
			if (outcome) session.counts.killed++;

			continue;
		}

		session.counts.survivors++;
		session.counts.probes++;
		survived = true;

		const source = sources.find((candidate) => candidate.path === mutant.file)!;
		const probe = probeOf(mutant.file, source.head, mutant.line);

		const probed = await session.run(
			mutantCommand({ source: { path: probe.file, text: probe.text }, oldTest: null, run: command })
		);

		if (probed?.verdict === 'fail' && probed.output.includes('recoder-probe')) {
			return provenResult(
				suspicion,
				mutant,
				`mutant "${mutant.description}" in ${mutant.file}: ${file.path} passed; probe on line ${mutant.line} failed (${command})`
			);
		}
	}

	if (survived) session.skip('unreachable');

	return null;
}

/**
 * Runs the test matrix, within the budget, on the edited test files and on
 * the files the detectors suspect. One finding per test file at most.
 */
export async function testMatrix(input: {
	tests: TestFileVersions[];
	suspicions: DetectorResult[];
	sources: Map<string, string>;
	added: AddedLines;
	commandFor: (path: string) => string | null;
	run: Runner;
	deadline: number;
}): Promise<MatrixOutcome> {
	const { tests, suspicions, sources, added, commandFor, run, deadline } = input;
	const session = new Session(run, deadline);
	const results: DetectorResult[] = [];

	session.counts.suspicions = suspicions.length;

	for (const file of tests) {
		const mine = suspicions.filter((suspicion) => suspicion.file === file.path);
		const edited = Boolean(file.base) && file.base !== file.head;

		if (!edited && !mine.length) continue;

		session.counts.files++;

		const command = commandFor(file.path);
		const oldCommand = edited ? commandFor(oldCopyPath(file.path)) : null;
		const candidates = sourcesFor(file, sources);

		if (!command) {
			session.skip('no-single-file-command');

			continue;
		}

		const sanity = await session.run(mutantCommand({ source: null, oldTest: null, run: command }));

		if (sanity?.verdict !== 'pass') {
			if (sanity) {
				session.skip('sanity-failed');
				session.counts.sanityOutput ??= sanity.output.slice(0, 300);
			}

			continue;
		}

		session.counts.sanityPassed++;

		const found =
			(await firstProven(session, file, mine, candidates, command)) ??
			(edited && oldCommand && candidates.length
				? await oldNewRow({ session, file, sources: candidates, commands: { head: command, old: oldCommand }, added })
				: null);

		if (found) results.push(found);
	}

	session.counts.findings = results.length;

	return { results, counts: session.counts };
}

/** The first suspicion of a file the runs prove. */
async function firstProven(
	session: Session,
	file: TestFileVersions,
	suspicions: DetectorResult[],
	sources: Source[],
	command: string
): Promise<DetectorResult | null> {
	for (const suspicion of suspicions) {
		const found = await suspicionRow({ session, file, suspicion, sources, command });

		if (found) return found;
	}

	return null;
}
