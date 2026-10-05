import type { ReviewRun } from '../harness/context.js';
import { isTestPath } from '../change-model/test-files.js';
import { addedLines } from '../detectors/changed-lines.js';
import { readFilesAt } from '../detectors/repo-files.js';
import { readTestFiles } from '../detectors/test-files.js';
import type { DetectorResult } from '../detectors/types.js';
import { MATRIX_BUDGET_MS, emptyCounts, testMatrix, type MatrixCounts, type SkipReason } from './matrix.js';
import { singleFileCommands } from './test-run.js';

const SCRIPT_SOURCE = /\.[cm]?[jt]sx?$/;

/** Detectors whose suspicions the matrix can prove or leave to the verifier. */
const SUSPECTING = new Set(['weak-new-tests', 'weakened-tests']);

/** What the matrix did and found in one review, for the task row and the benchmark report. */
export interface MatrixReport {
	results: DetectorResult[];
	counts: MatrixCounts;
	/** Why it did not run at all. */
	skipped?: SkipReason;
}

/** The task row's detail: the counts, or the reason the matrix did not run. */
export function matrixDetail(report: MatrixReport): string {
	if (report.skipped) return `Skipped: ${report.skipped}`;

	const { counts } = report;

	const failed = counts.sanityOutput
		? [`sanity output: ${counts.sanityOutput.replace(/\s+/g, ' ').slice(0, 160)}`]
		: [];

	const skips = Object.entries(counts.skips).map(([reason, count]) => `${reason} ×${count}`);

	return [
		`${counts.suspicions} suspicions`,
		`${counts.files} files`,
		`${counts.sanityPassed} sanity runs passed`,
		`${counts.probes} probes`,
		`${counts.mutants} mutants (${counts.killed} killed, ${counts.survivors} survived)`,
		`${counts.findings} findings`,
		`${counts.runs} runs in ${Math.round(counts.ms / 1000)}s`,
		...(skips.length ? [`skips: ${skips.join(', ')}`] : []),
		...failed
	].join(' · ');
}

/**
 * The matrix findings for the edited tests and the tests a detector
 * suspects, once the install and baseline checks are done. Every run goes
 * through the workspace, which puts the checkout back after each one; a final
 * `git status` shows nothing was left behind.
 */
export async function runMatrix(run: ReviewRun): Promise<MatrixReport> {
	const revision = run.input.revision;
	const workspace = run.workspace;
	const skip = (reason: SkipReason): MatrixReport => ({ results: [], counts: emptyCounts(), skipped: reason });

	if (!revision || !workspace) return skip('no-sandbox');

	const suspicions = run.detections.filter((result) => result.suspected && SUSPECTING.has(result.detector));
	const added = addedLines(run.inventory);
	const signal = run.controller.signal;
	const tests = await readTestFiles({ inventory: run.inventory, added, revision, signal });
	const wanted = new Set(suspicions.map((suspicion) => suspicion.file));
	const relevant = tests.filter((file) => wanted.has(file.path) || (file.base && file.base !== file.head));

	if (!relevant.length) return skip('no-suspicion');

	const candidates = run.inventory.files
		.filter((file) => !file.excludeReason && file.status !== 'deleted' && SCRIPT_SOURCE.test(file.path))
		.filter((file) => !isTestPath(file.path))
		.map((file) => file.path);

	const sources = await readFilesAt(revision.checkoutPath, revision.headSha, candidates, signal);
	const scriptLines = await workspace.scripts();

	const outcome = await testMatrix({
		tests: relevant,
		suspicions,
		sources,
		added,
		commandFor: singleFileCommands(
			scriptLines,
			run.baseline.map((check) => check.command)
		),
		run: (command, timeoutMs) => workspace.run(command, timeoutMs, signal, 'mutation'),
		deadline: Date.now() + MATRIX_BUDGET_MS
	});

	const left = await workspace.run('git status --porcelain --untracked-files=no', 15_000, signal, 'mutation');

	if (left.output.trim()) run.events?.onLog?.(`Test matrix left changes in the checkout: ${left.output.slice(0, 200)}`);

	if (outcome.counts.sanityOutput) run.events?.onLog?.(`Test matrix sanity run failed: ${outcome.counts.sanityOutput}`);

	return outcome;
}
