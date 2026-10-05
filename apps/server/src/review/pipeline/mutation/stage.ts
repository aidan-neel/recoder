import type { ReviewRun } from '../harness/context.js';
import { isTestPath } from '../change-model/test-files.js';
import { addedLines } from '../detectors/changed-lines.js';
import { readFilesAt } from '../detectors/repo-files.js';
import { readTestFiles } from '../detectors/test-files.js';
import type { DetectorResult } from '../detectors/types.js';
import { MATRIX_BUDGET_MS, testMatrix } from './matrix.js';
import { singleFileCommands } from './test-run.js';

const SCRIPT_SOURCE = /\.[cm]?[jt]sx?$/;

/**
 * The matrix findings for the edited tests, once the install and baseline
 * checks are done. Nothing without a sandbox, a checkout or a baseline test
 * command. Every run goes through the workspace, so the shared checkout is
 * put back after each one.
 */
export async function runMatrix(run: ReviewRun): Promise<DetectorResult[]> {
	const revision = run.input.revision;
	const workspace = run.workspace;

	if (!revision || !workspace) return [];

	const added = addedLines(run.inventory);
	const signal = run.controller.signal;
	const tests = await readTestFiles({ inventory: run.inventory, added, revision, signal });
	const edited = tests.filter((file) => file.base && file.base !== file.head);

	if (!edited.length) return [];

	const candidates = run.inventory.files
		.filter((file) => !file.excludeReason && file.status !== 'deleted' && SCRIPT_SOURCE.test(file.path))
		.filter((file) => !isTestPath(file.path))
		.map((file) => file.path);

	const sources = await readFilesAt(revision.checkoutPath, revision.headSha, candidates, signal);
	const scriptLines = await workspace.scripts();

	const outcome = await testMatrix({
		tests: edited,
		sources,
		added,
		commandFor: singleFileCommands(
			scriptLines,
			run.baseline.map((check) => check.command)
		),
		run: (command, timeoutMs) => workspace.run(command, timeoutMs, signal, 'mutation'),
		deadline: Date.now() + MATRIX_BUDGET_MS
	});

	run.events?.onLog?.(
		`Test matrix: ${outcome.runs} runs, ${outcome.results.length} finding${outcome.results.length === 1 ? '' : 's'}${outcome.skipped ? ` (${outcome.skipped})` : ''}`
	);

	return outcome.results;
}
