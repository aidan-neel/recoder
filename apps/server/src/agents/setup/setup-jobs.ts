import { randomUUID } from 'node:crypto';
import type { AgentSetupJob } from '@recoder/shared';
import { emptyDirectory, killGroup, stopOnShutdown } from '../cli-process';
import type { AgentAdapter, AgentSetupStep } from '../contract';
import { forgetAgentModels } from '../registry';
import { SetupOutput } from './setup-output';

/** A job dies when it still runs after this; a browser sign-in someone abandoned must not linger forever. */
const JOB_DEADLINE_MS = 15 * 60_000;

/** A finished job stays visible this long after it ends, so a page polling it sees the outcome. */
const JOB_KEEP_MS = 10 * 60_000;

/** A job that prints more than this is killed; a runaway installer must not grow memory without end. */
const OUTPUT_CAP_BYTES = 1_000_000;

/** How long the download of a vendor's installer script may take. */
const SCRIPT_FETCH_TIMEOUT_MS = 60_000;

export type SetupStep = 'install' | 'sign-in';

/** The response a setup route gives when a job cannot start or be found: a message and the status for it. */
export class SetupJobError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 500 | 502
	) {
		super(message);
	}
}

interface Job {
	readonly id: string;
	readonly adapter: AgentAdapter;
	readonly step: SetupStep;
	readonly proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
	readonly output: SetupOutput;
	/** The step's declared needsInput flag: whether the CLI may wait for a pasted code or token on stdin. */
	readonly wantsInput: boolean;
	status: AgentSetupJob['status'];
	error: string | null;
	cancelled: boolean;
	deadline: ReturnType<typeof setTimeout> | null;
	purge: ReturnType<typeof setTimeout> | null;
}

/** Every job the server still remembers, including finished ones kept for {@link JOB_KEEP_MS}. */
const jobs = new Map<string, Job>();

/** The one setup job each agent may have running. */
const running = new Map<string, Job>();

stopOnShutdown('agent-setup', () => {
	for (const job of running.values()) killGroup(job.proc);
});

/**
 * Starts an agent's own install or sign-in command as a job. One job per agent at a time; the command comes from
 * the adapter's `setup`, never from the request. Throws a {@link SetupJobError} the route maps to its status.
 */
export async function startSetupJob(
	adapter: AgentAdapter,
	step: SetupStep,
	deadlineMs = JOB_DEADLINE_MS
): Promise<AgentSetupJob> {
	const spec = step === 'install' ? adapter.setup?.install : adapter.setup?.signIn;

	if (!spec)
		throw new SetupJobError(`Recoder cannot ${step === 'install' ? 'install' : 'sign in'} ${adapter.name}.`, 400);

	const busy = running.get(adapter.id);

	if (busy) throw new SetupJobError(`${adapter.name} already has a ${busy.step} job running.`, 409);

	const script = spec.stdinUrl ? await download(spec.stdinUrl, adapter.name) : null;
	const argv = await stepArgv(adapter, step, spec);
	const proc = spawnSetup(argv, adapter, spec, await emptyDirectory('agent-setup'));

	const job: Job = {
		id: randomUUID(),
		adapter,
		step,
		proc,
		output: new SetupOutput(),
		wantsInput: spec.needsInput === true,
		status: 'running',
		error: null,
		cancelled: false,
		deadline: null,
		purge: null
	};

	jobs.set(job.id, job);
	running.set(adapter.id, job);
	job.deadline = setTimeout(() => expire(job), deadlineMs);

	void readInto(proc.stdout, job);
	void readInto(proc.stderr, job);
	void proc.exited.then((code) => finish(job, code));

	if (script) void feed(job, script);

	return view(job);
}

/** The job as it stands, or null once it has been forgotten. */
export function getSetupJob(id: string): AgentSetupJob | null {
	const job = jobs.get(id);

	return job ? view(job) : null;
}

/**
 * Writes `text` to the job's stdin — a pasted sign-in code or token — and secrets it out of the job's output.
 * The pipe stays open for a further prompt; it dies with the CLI.
 */
export async function setupJobInput(id: string, text: string): Promise<AgentSetupJob> {
	const job = jobs.get(id);

	if (!job) throw new SetupJobError('That setup job is no longer known.', 404);
	if (job.status !== 'running') throw new SetupJobError('That setup job already finished.', 409);
	if (!job.wantsInput) throw new SetupJobError('That setup job does not read input.', 400);

	job.output.addSecret(text);

	try {
		job.proc.stdin.write(text.endsWith('\n') ? text : `${text}\n`);
		await job.proc.stdin.flush();
	} catch {
		throw new SetupJobError('The CLI is no longer reading input.', 409);
	}

	return view(job);
}

/** Kills a running job's whole process group; a finished job just stays until its keep time runs out. */
export function cancelSetupJob(id: string): void {
	const job = jobs.get(id);

	if (!job) throw new SetupJobError('That setup job is no longer known.', 404);

	if (job.status !== 'running') return;

	job.cancelled = true;
	killGroup(job.proc);
}

/** The job's public form: its state plus the redacted tail of its output and the sign-in URL it printed. */
function view(job: Job): AgentSetupJob {
	return {
		id: job.id,
		agent: job.adapter.id,
		step: job.step,
		status: job.status,
		output: job.output.text(),
		url: job.output.url(),
		needsInput: job.status === 'running' && job.wantsInput,
		error: job.error
	};
}

/** What a sign-in step's `argv[0]` resolves to: the binary the adapter found; an install's argv is used as declared. */
async function stepArgv(adapter: AgentAdapter, step: SetupStep, spec: AgentSetupStep): Promise<string[]> {
	if (step !== 'sign-in') return [...spec.argv];

	const path = (await adapter.detect()).path;

	if (!path) throw new SetupJobError(`${adapter.name} is not installed.`, 400);

	return [path, ...spec.argv.slice(1)];
}

/** A vendor installer script fetched for `bash -s`; an unfetchable one stops the job before it starts. */
async function download(url: string, name: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(SCRIPT_FETCH_TIMEOUT_MS) }).catch(() => null);

	if (!response?.ok) throw new SetupJobError(`The ${name} installer could not be downloaded.`, 502);

	return response.text();
}

/** The job process: its own process group (`detached`) so cancelling kills everything the CLI started. */
function spawnSetup(
	argv: string[],
	adapter: AgentAdapter,
	spec: AgentSetupStep,
	cwd: string
): Bun.Subprocess<'pipe', 'pipe', 'pipe'> {
	try {
		return Bun.spawn(argv, {
			env: { ...adapter.setupEnv(), ...spec.env },
			cwd,
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
			detached: true
		});
	} catch (error) {
		throw new SetupJobError(
			`Could not start ${adapter.name}'s ${spec.stdinUrl ? 'installer' : 'command'}: ${error instanceof Error ? error.message : 'the CLI could not be spawned.'}`,
			500
		);
	}
}

/**
 * Pipes a fetched installer script into the job's stdin (`bash -s`), from behind the readers so a script larger
 * than the pipe never stalls against output nobody drains yet. A write the pipe refuses kills the job.
 */
async function feed(job: Job, script: string): Promise<void> {
	try {
		job.proc.stdin.write(script);
		await job.proc.stdin.end();
	} catch {
		job.error ??= `The ${job.adapter.name} installer could not be written to the shell.`;
		killGroup(job.proc);
	}
}

/**
 * Folds a stream into the job's output until it ends or the job is killed (a dead process cuts its pipes, and the
 * `exited` promise is what settles the job). Over the byte cap the job is killed as printing too much.
 */
async function readInto(stream: ReadableStream<Uint8Array>, job: Job): Promise<void> {
	const decoder = new TextDecoder();

	try {
		for await (const chunk of stream) {
			job.output.push(decoder.decode(chunk, { stream: true }));

			if (job.output.bytes > OUTPUT_CAP_BYTES) {
				job.error = `${job.adapter.name} printed more output than a setup job keeps.`;
				killGroup(job.proc);

				return;
			}
		}

		job.output.push(decoder.decode());
	} catch {}
}

/**
 * Settles the job from the process's exit and forgets it after {@link JOB_KEEP_MS}. Whatever it ended as, the
 * agent's status is checked again — an install may have landed a binary, a sign-in a credential — and the model
 * list is listed afresh on its next read.
 */
function finish(job: Job, code: number | null): void {
	if (job.status !== 'running') return;

	job.status = job.cancelled ? 'cancelled' : code === 0 ? 'done' : 'failed';

	job.error ??=
		job.status === 'failed'
			? `${job.adapter.name}'s ${job.step === 'install' ? 'installer' : 'sign-in'} exited with code ${code ?? 'unknown'}.`
			: null;

	running.delete(job.adapter.id);
	if (job.deadline) clearTimeout(job.deadline);
	job.purge = setTimeout(() => jobs.delete(job.id), JOB_KEEP_MS);

	void job.adapter
		.detect(true)
		.catch(() => null)
		.finally(forgetAgentModels);
}

/** The deadline: kills the job's process group; the exit then settles it as failed with the timeout's message. */
function expire(job: Job): void {
	if (job.status !== 'running') return;

	job.error ??= `${job.adapter.name}'s ${job.step === 'install' ? 'install' : 'sign-in'} took too long and was stopped.`;
	killGroup(job.proc);
}
