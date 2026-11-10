import { z } from 'zod';
import { CliError, EXIT } from '../exit.js';
import type { ReviewTarget } from '../review/options.js';
import { isRunId, type RunId } from './run-id.js';
import { parseJson, readTextIfPresent, writeFileAtomically, type RunFiles } from './run-files.js';

/** Raised when a field is removed or changes meaning. */
const RUN_SCHEMA_VERSION = 1;

/** Process 1 is init; no run is ever that process. */
const FIRST_USER_PID = 2;

const RUN_STATES = ['running', 'complete', 'failed', 'cancelled'] as const;

const TARGET_KINDS = [
	'range',
	'staged',
	'uncommitted',
	'pull',
	'diff'
] as const satisfies readonly ReviewTarget['kind'][];

const EXIT_CODES = [EXIT.ok, EXIT.findings, EXIT.usage, EXIT.failed, EXIT.notReady, EXIT.cancelled] as const;

/** `run.json` is read back from disk, so it is parsed as outside input. */
const runRecordSchema = z.object({
	schemaVersion: z.literal(RUN_SCHEMA_VERSION),
	runId: z.custom<RunId>((value) => typeof value === 'string' && isRunId(value)),
	/** The process responsible for the run now; see `ProcessIdentity`. Never 1, so a damaged record cannot signal init. */
	pid: z.number().int().min(FIRST_USER_PID).max(Number.MAX_SAFE_INTEGER),
	processStartedAt: z.iso.datetime(),
	state: z.enum(RUN_STATES),
	/** The last stage the review reported; null before the first. */
	stage: z.string().nullable(),
	startedAt: z.iso.datetime(),
	finishedAt: z.iso.datetime().nullable(),
	repoPath: z.string(),
	targetKind: z.enum(TARGET_KINDS),
	/**
	 * The code the run's process exited with; null while it runs. When the review returned a report, `state` is the
	 * report's outcome, and the code can still say that writing the report out failed.
	 */
	exitCode: z.literal(EXIT_CODES).nullable(),
	error: z.string().nullable(),
	findings: z.number().int().nonnegative().nullable(),
	unconfirmed: z.number().int().nonnegative().nullable()
});

/** What one run records about itself in `run.json`. JSON-safe. */
export type RunRecord = z.infer<typeof runRecordSchema>;

export type RunState = RunRecord['state'];

/** A `run.json` that exists but cannot be read as a record: cut short, edited by hand or from another version. */
export class UnreadableRunError extends CliError {
	constructor(
		readonly runId: RunId,
		reason: string
	) {
		super(`run ${runId} has an unreadable run.json: ${reason}`, EXIT.failed);
		this.name = 'UnreadableRunError';
	}
}

/** The fields a new record starts with. */
export function newRecord(
	fields: Pick<RunRecord, 'runId' | 'pid' | 'processStartedAt' | 'repoPath' | 'targetKind' | 'startedAt'>
): RunRecord {
	return {
		schemaVersion: RUN_SCHEMA_VERSION,
		...fields,
		state: 'running',
		stage: null,
		finishedAt: null,
		exitCode: null,
		error: null,
		findings: null,
		unconfirmed: null
	};
}

/** The run's record; null when it has none, which is a run still being created or one already removed. */
export async function readRunRecord(runId: RunId, files: RunFiles): Promise<RunRecord | null> {
	const text = await readTextIfPresent(files.record);

	if (text === null) return null;

	const parsed = runRecordSchema.safeParse(parseJson(text, (reason) => new UnreadableRunError(runId, reason)));

	if (!parsed.success) throw new UnreadableRunError(runId, z.prettifyError(parsed.error).replace(/\s*\n\s*/g, ' '));

	if (parsed.data.runId !== runId) throw new UnreadableRunError(runId, `it names run ${parsed.data.runId}`);

	return parsed.data;
}

export async function writeRunRecord(files: RunFiles, record: RunRecord): Promise<void> {
	await writeFileAtomically(files.record, `${JSON.stringify(record)}\n`);
}
