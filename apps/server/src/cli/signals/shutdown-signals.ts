import { readFileSync } from 'node:fs';
import { errorCode } from '../exit.js';

/** The stops a caller sends on purpose: Ctrl-C, `kill` or a tool runner's timeout. */
export const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * The stops a caller sends, and the hang-up of a closing terminal. Each is handled, so it runs the cleanup and the
 * `exit` hooks that stop agent children; a signal that ended the process by itself would skip them and leave
 * `opencode serve` running.
 */
const SHUTDOWN_SIGNALS = [...STOP_SIGNALS, 'SIGHUP'] as const;

/** Linux lists the signals a process ignores in this file, as a hex mask. */
const PROCESS_STATUS_FILE = '/proc/self/status';

const IGNORED_SIGNALS_LINE = /^SigIgn:\s*([0-9a-f]+)$/m;

const HEX_RADIX = 16;

/** SIGHUP is signal 1, so it is the mask's lowest bit. */
const HANG_UP_BIT = 1;

let isHangUpIgnoredAtStart: boolean | null = null;

/**
 * The shutdown signals this process handles. A process started with SIGHUP ignored (`nohup`, `trap '' HUP`) leaves it
 * ignored: a listener would replace the ignore, and nothing can put it back.
 */
export function shutdownSignals(): readonly NodeJS.Signals[] {
	return isHangUpIgnored() ? STOP_SIGNALS : SHUTDOWN_SIGNALS;
}

/**
 * Lets the process outlive a hang-up: `recoder review --detach` hands its run to a process in its own session, so a
 * closing terminal must not cancel the start. A hang-up that is already ignored stays so.
 */
export function outliveHangUp(): void {
	if (!isHangUpIgnored()) process.on('SIGHUP', ignoreSignal);
}

/** Stands in for the default action, which would end the process. */
function ignoreSignal(): void {
	return undefined;
}

/**
 * Whether SIGHUP was ignored when the process started. Every SIGHUP listener of the command line is installed through
 * this module, after this first read. Bun starts each child with default signal actions (measured on Linux with Bun
 * 1.4.2), so a child cannot inherit the ignore and must be told instead.
 */
function isHangUpIgnored(): boolean {
	isHangUpIgnoredAtStart ??= readIsHangUpIgnored();

	return isHangUpIgnoredAtStart;
}

/**
 * macOS has no `/proc`, and its `ps` has no column for ignored signals (Darwin 24 lists only `sig`, `sigmask`,
 * `blocked` and `pending`), so there the answer is false and SIGHUP is handled as it always was.
 */
function readIsHangUpIgnored(): boolean {
	const status = readProcessStatus();

	if (status === null) return false;

	const mask = IGNORED_SIGNALS_LINE.exec(status)?.[1];

	if (mask === undefined) throw new Error(`${PROCESS_STATUS_FILE} has no SigIgn line`);

	return (Number.parseInt(mask.slice(-1), HEX_RADIX) & HANG_UP_BIT) !== 0;
}

function readProcessStatus(): string | null {
	try {
		return readFileSync(PROCESS_STATUS_FILE, 'utf8');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;

		throw error;
	}
}
