import { appendFileSync } from 'node:fs';
import { usageError } from '../exit.js';
import { createProgressSink } from '../output/progress-sink.js';
import type { ProgressSink } from '../progress.js';
import type { ReviewReport } from '../report/report.js';
import type { ReviewTarget } from '../review/options.js';
import { currentProcessIdentity } from './process-identity.js';
import type { RunEnd } from './run-end.js';
import { createRunId, type RunId } from './run-id.js';
import { PRIVATE_FILE_MODE, createRunFolder, runFiles, warnRecordFailure, type RunFiles } from './run-files.js';
import { newRecord, readRunRecord, writeRunRecord, type RunRecord } from './run-record.js';
import { saveReport } from './stored-report.js';

/** What a new run records about what it reviews. */
export interface NewRun {
	repoPath: string;
	targetKind: ReviewTarget['kind'];
}

/**
 * The one writer of a run's files while its process runs: the record, the progress file and the report. Writes to
 * `run.json` go out in order, one at a time. A write that fails is said on standard error and the review goes on.
 */
export class RunJournal {
	private pendingWrite: Promise<void> = Promise.resolve();

	private isProgressFileBroken = false;

	private constructor(
		private readonly files: RunFiles,
		private record: RunRecord
	) {}

	/** Creates a run that this process is responsible for. */
	static async create(run: NewRun): Promise<RunJournal> {
		const startedAt = new Date();
		const runId = createRunId(startedAt);
		const files = await createRunFolder(runId);
		const identity = await currentProcessIdentity();
		const record = newRecord({ runId, ...identity, ...run, startedAt: startedAt.toISOString() });

		await writeRunRecord(files, record);

		return new RunJournal(files, record);
	}

	/**
	 * Takes over a run that `recoder review --detach` created for this process. Only the process that created it, which
	 * is this one's parent, may hand it over, so a run id passed by hand cannot take over another run.
	 */
	static async takeOver(runId: RunId): Promise<RunJournal> {
		const files = runFiles(runId);
		const record = await readRunRecord(runId, files);

		if (record?.state !== 'running' || record.pid !== process.ppid) {
			throw usageError(`run ${runId} is not waiting for a background review.`);
		}

		const taken = { ...record, ...(await currentProcessIdentity()) };

		await writeRunRecord(files, taken);

		return new RunJournal(files, taken);
	}

	get runId(): RunId {
		return this.record.runId;
	}

	/** Every event goes to the progress file; a new stage also goes to the record. */
	progressSink(): ProgressSink {
		const toFile = createProgressSink(
			'ndjson',
			(line) => this.appendProgress(line),
			() => new Date()
		);

		return (event) => {
			toFile(event);

			if (event.type === 'stage') this.recordStage(event.stage);
		};
	}

	/** Saves the complete report and returns whether it was saved. */
	async saveReport(report: ReviewReport): Promise<boolean> {
		try {
			await saveReport(this.files, report);

			return true;
		} catch (error) {
			warnRecordFailure(this.runId, 'save the report', error);

			return false;
		}
	}

	async finish(end: RunEnd): Promise<void> {
		await this.update({ ...this.record, ...end, finishedAt: new Date().toISOString() });
	}

	/** One progress file write failing says so once; the rest are skipped rather than repeating it per event. */
	private appendProgress(line: string): void {
		if (this.isProgressFileBroken) return;

		try {
			appendFileSync(this.files.progress, `${line}\n`, { mode: PRIVATE_FILE_MODE });
		} catch (error) {
			this.isProgressFileBroken = true;
			warnRecordFailure(this.runId, 'record progress', error);
		}
	}

	private recordStage(stage: string): void {
		if (stage === this.record.stage) return;

		void this.update({ ...this.record, stage });
	}

	private update(record: RunRecord): Promise<void> {
		this.record = record;

		this.pendingWrite = this.pendingWrite
			.then(() => writeRunRecord(this.files, record))
			.catch((error: unknown) => warnRecordFailure(this.runId, 'update run.json', error));

		return this.pendingWrite;
	}
}
