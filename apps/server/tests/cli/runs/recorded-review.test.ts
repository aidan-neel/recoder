import { expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { parseReviewArgs } from '../../../src/cli/args/review-args';
import { CliError, EXIT, notReadyError } from '../../../src/cli/exit';
import type { ReportDestination } from '../../../src/cli/output/deliver';
import type { ReviewReport } from '../../../src/cli/report/report';
import { runReviewFlow } from '../../../src/cli/run/run-flow';
import { runRecordedReview, type ReviewRunner } from '../../../src/cli/runs/recorded-review';
import { printRunResult } from '../../../src/cli/runs/result-command';
import { runFiles } from '../../../src/cli/runs/run-files';
import { RunJournal } from '../../../src/cli/runs/run-journal';
import { readRunRecord } from '../../../src/cli/runs/run-record';
import { assertNotCancelled } from '../../../src/cli/target/git';
import { restoreAfterEach, useTestModel } from '../../review/pipeline/harness-fixtures';
import { OUTPUT, finding, report } from '../output/fixtures';
import { useFreshDataDir } from './run-fixtures';

useFreshDataDir();

restoreAfterEach();

const SILENT: ReportDestination = { writeStdout: async () => {}, writeFile: async () => {} };

const UNWRITABLE: ReportDestination = {
	writeStdout: async () => {},
	writeFile: () => Promise.reject(new Error('disk full'))
};

/** What a test changes about a run: its extra flags, where its report goes, and the stop its review runs under. */
interface RunSetup {
	argv?: string[];
	destination?: ReportDestination;
	signal?: AbortSignal;
}

/** Runs a review under a new run with `runner`, and returns the run's id and how the command ended. */
async function runWith(runner: ReviewRunner, setup: RunSetup = {}) {
	const { argv = [], destination = SILENT, signal = new AbortController().signal } = setup;
	const { options } = parseReviewArgs(['--diff', 'change.patch', '--progress', 'none', ...argv], '/work');
	const journal = await RunJournal.create({ repoPath: options.repoPath, targetKind: options.target.kind });

	const outcome = await runRecordedReview({
		options,
		journal,
		signal,
		loadRunner: async () => runner,
		destination,
		onEndRecorded: () => {}
	})
		.then((exitCode) => ({ exitCode, error: null }))
		.catch((error: unknown) => ({ exitCode: null, error }));

	return { runId: journal.runId, ...outcome };
}

function returning(result: ReviewReport): ReviewRunner {
	return async () => result;
}

function throwing(error: unknown): ReviewRunner {
	return async () => {
		throw error;
	};
}

test('a review that returns a report records its outcome, counts and exit code, and saves the report', async () => {
	const withFindings = report({ findings: [finding({ severity: 'error' })], unconfirmed: [finding({ id: 'u' })] });
	const { runId, exitCode } = await runWith(returning(withFindings), { argv: ['--fail-on', 'error'] });
	const record = await readRunRecord(runId, runFiles(runId));

	expect(exitCode).toBe(EXIT.findings);
	expect(record).toMatchObject({ state: 'complete', exitCode: EXIT.findings, findings: 1, unconfirmed: 1 });
	expect(record?.finishedAt).not.toBeNull();
	expect(existsSync(runFiles(runId).report)).toBe(true);
});

test('a machine that is not ready, found after the run exists, leaves the run failed with that exit code', async () => {
	const { runId, error } = await runWith(throwing(notReadyError('No review model is configured.')));

	expect(error).toBeInstanceOf(CliError);

	expect(await readRunRecord(runId, runFiles(runId))).toMatchObject({
		state: 'failed',
		exitCode: EXIT.notReady,
		error: 'No review model is configured.'
	});
});

test('an unexpected throw leaves the run failed, not running', async () => {
	const { runId } = await runWith(throwing(new TypeError('boom')));

	expect(await readRunRecord(runId, runFiles(runId))).toMatchObject({ state: 'failed', exitCode: EXIT.failed });
});

test('a cancel before the report leaves the run cancelled', async () => {
	const { runId } = await runWith(throwing(new CliError('The review was cancelled.', EXIT.cancelled)));

	expect(await readRunRecord(runId, runFiles(runId))).toMatchObject({ state: 'cancelled', exitCode: EXIT.cancelled });
});

test('a report that cannot be written to --output is kept and the error names the command that prints it', async () => {
	const { runId, error } = await runWith(returning(report()), {
		argv: ['--output', '/out/review.json'],
		destination: UNWRITABLE
	});

	expect(error).toMatchObject({ exitCode: EXIT.failed, message: expect.stringContaining(`recoder result ${runId}`) });
	expect(await readRunRecord(runId, runFiles(runId))).toMatchObject({ state: 'complete', exitCode: EXIT.failed });
	expect(existsSync(runFiles(runId).report)).toBe(true);
});

/** The real review flow, cancelled by `stop` while it prepares the target, as a git call there sees it. */
function cancelledWhilePreparing(stop: AbortController): ReviewRunner {
	return (options, progress, signal) =>
		runReviewFlow(
			async (request) => {
				stop.abort();
				assertNotCancelled(request.signal);

				throw new Error('the target was prepared after all');
			},
			options,
			progress,
			signal
		);
}

test('a cancel while the target is prepared leaves the run cancelled with its error, which result prints', async () => {
	const stop = new AbortController();

	useTestModel();

	const { runId } = await runWith(cancelledWhilePreparing(stop), { signal: stop.signal });
	const record = await readRunRecord(runId, runFiles(runId));
	const error = record?.error ?? null;
	const written: unknown[] = [];
	const stderr = spyOn(process.stderr, 'write').mockImplementation((chunk) => written.push(chunk) > 0);
	const result = await printRunResult(runId, OUTPUT, SILENT).finally(() => stderr.mockRestore());

	expect(record).toMatchObject({ state: 'cancelled', exitCode: EXIT.cancelled });
	expect(error).not.toBeNull();
	expect(result).toBe(EXIT.cancelled);
	expect(written.join('')).toContain(error ?? '');
});
