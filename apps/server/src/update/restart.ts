import { connect } from 'node:net';
import { childEnv } from '../util/process';

/**
 * Set in the spawned successor's environment, so its boot knows to wait for
 * this process's port before it binds its own.
 */
export const SUCCESSOR_ENV = 'RECODER_WAIT_FOR_PORT';

/** How long the successor waits for the old process's port before it tries to bind anyway. */
const PORT_RELEASE_TIMEOUT_MS = 120_000;

const PORT_POLL_MS = 100;

/**
 * Starts the server this process is, again — same argv, env and cwd — as a
 * detached child that outlives this process and waits for its port. Output
 * still goes to this terminal, so a `bun run dev` session keeps showing the
 * new server's logs.
 */
function spawnSuccessor(): void {
	const child = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
		cwd: process.cwd(),
		env: childEnv({ [SUCCESSOR_ENV]: '1' }),
		stdin: 'ignore',
		stdout: 'inherit',
		stderr: 'inherit',
		detached: true
	});

	child.unref();
}

/**
 * Ends this process the way a person's SIGTERM does: the boot's
 * `exitOnShutdownSignals` handler drains queued persistence before the exit.
 */
function exitForSuccessor(): void {
	setImmediate(() => process.kill(process.pid, 'SIGTERM'));
}

/** The production restart step for the update service. */
export function restartThroughSuccessor(): void {
	spawnSuccessor();
	exitForSuccessor();
}

/** Whether a TCP connection to `host:port` is refused — nothing is listening there anymore. */
function portFree(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });

		socket.once('connect', () => {
			socket.destroy();
			resolve(false);
		});

		socket.once('error', () => {
			socket.destroy();
			resolve(true);
		});
	});
}

/** A wildcard listen address is reached through its loopback. */
function loopback(host: string): string {
	if (host === '0.0.0.0') return '127.0.0.1';
	if (host === '::') return '::1';

	return host;
}

/**
 * The successor's half of the handover: poll until the port the old server
 * still holds is free, then return so the boot can bind it. Returns after the
 * timeout too — `Bun.serve`'s own bind error is clearer than a second guess.
 */
export async function waitForPortRelease(
	host: string,
	port: number,
	timeoutMs = PORT_RELEASE_TIMEOUT_MS
): Promise<void> {
	const address = loopback(host);
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await portFree(address, port)) return;

		await new Promise((resolve) => setTimeout(resolve, PORT_POLL_MS));
	}
}
