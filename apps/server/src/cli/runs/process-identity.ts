import { processOutput } from '../../util/process.js';
import { CliError, EXIT, describeError, errorCode } from '../exit.js';

/**
 * A process id alone does not name a process: once it ends, the system may give its id to another. A run therefore
 * records its process id with the time that process started, and a process counts as the run's only when both match.
 * `ps -o lstart= -p <pid>` prints that time on Linux (procps) and macOS (BSD ps) in the same `Tue Nov 10 15:30:45 2026`
 * form; `LC_ALL=C` and `TZ=UTC` make every caller read it the same way.
 */
export interface ProcessIdentity {
	pid: number;
	/** When the process started, as an ISO time to the second. */
	processStartedAt: string;
}

/**
 * Linux works the start time out from the boot time, which clock adjustments can move by a second, so two reads of one
 * process may differ by that much. A different process would need the same id within this window, which the id
 * counter does not reach that fast.
 */
const START_TOLERANCE_MS = 2_000;

const PS_TIMEOUT_MS = 10_000;

const PS_ENVIRONMENT = { LC_ALL: 'C', TZ: 'UTC' };

const PS_START_TIME = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** This process, as a run records it. */
export async function currentProcessIdentity(): Promise<ProcessIdentity> {
	const startedAt = await readProcessStart(process.pid);

	if (startedAt === null) throw new Error(`ps did not list this process (${process.pid})`);

	return { pid: process.pid, processStartedAt: startedAt.toISOString() };
}

/** Whether the process with this id is still the one that was recorded. */
export async function isSameProcess(identity: ProcessIdentity): Promise<boolean> {
	const startedAt = await readProcessStart(identity.pid);

	if (startedAt === null) return false;

	return Math.abs(startedAt.getTime() - Date.parse(identity.processStartedAt)) <= START_TOLERANCE_MS;
}

/** When the process started, or null when no process has this id. */
async function readProcessStart(pid: number): Promise<Date | null> {
	if (!isProcessPresent(pid)) return null;

	const ps = startPs(pid);
	const { stdout, stderr, code } = await processOutput(ps);
	const text = stdout.trim();

	if (code === 0) return parseStartTime(pid, text);

	if (ps.signalCode === null && text === '' && stderr.trim() === '') return null;

	throw new Error(`ps could not read process ${pid}: ${stderr.trim() || `exit ${code}`}`);
}

/** `recoder doctor` says ps is needed; a machine without it gets one line saying so, not a stack trace. */
function startPs(pid: number) {
	try {
		return Bun.spawn(['ps', '-o', 'lstart=', '-p', String(pid)], {
			env: { ...process.env, ...PS_ENVIRONMENT },
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			timeout: PS_TIMEOUT_MS
		});
	} catch (error) {
		throw new CliError(
			`cannot run ps to check process ${pid}: ${describeError(error)}. Run recoder doctor to see what is missing.`,
			EXIT.notReady
		);
	}
}

/** Whether a process has this id. Signal 0 tests for it without touching it; EPERM means it exists. */
export function isProcessPresent(pid: number): boolean {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		if (errorCode(error) === 'ESRCH') return false;

		if (errorCode(error) === 'EPERM') return true;

		throw error;
	}
}

/** `ps` output is outside input: anything but the expected form is an error naming it. */
function parseStartTime(pid: number, text: string): Date {
	const match = PS_START_TIME.exec(text);
	const month = match === null ? -1 : MONTHS.indexOf(match[1]);

	if (match === null || month === -1)
		throw new Error(`ps printed an unexpected start time for process ${pid}: "${text}"`);

	const [, , day, hours, minutes, seconds, year] = match.map(Number);

	return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
}
