import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import type { HostConfig } from '$lib/reports/types';

/** Shared across dev-server module reloads, so a reload reuses the open forwards. */
interface TunnelState {
	/** The local URL of each forward by `host:port`, as a promise so callers that arrive together share one. */
	urls: Map<string, Promise<string>>;
	children: Set<ChildProcess>;
}

const state: TunnelState = ((globalThis as { benchTunnels?: TunnelState }).benchTunnels ??= createState());

/** ssh children outlive this process unless they are stopped when it exits. */
function createState(): TunnelState {
	const created: TunnelState = { urls: new Map(), children: new Set() };

	process.once('exit', () => {
		for (const child of created.children) child.kill();
	});

	return created;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();

		server.once('error', reject);

		server.listen(0, '127.0.0.1', () => {
			const address = server.address();

			server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject()));
		});
	});
}

function canConnect(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: '127.0.0.1' });

		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});

		socket.once('error', () => resolve(false));
	});
}

/** Resolves once the forward accepts connections, or rejects after about eight seconds. */
async function waitOpen(port: number, child: ChildProcess): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt++) {
		if (child.exitCode !== null) throw new Error('ssh port forward exited');
		if (await canConnect(port)) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}

	throw new Error('ssh port forward did not open');
}

/** Opens a forward and calls `closed` when its ssh process exits. */
async function open(target: HostConfig, remotePort: number, closed: () => void): Promise<string> {
	const port = await freePort();

	const child = spawn(
		'ssh',
		[
			'-N',
			'-C',
			'-o',
			'BatchMode=yes',
			'-o',
			'ControlMaster=no',
			'-o',
			'ExitOnForwardFailure=yes',
			'-o',
			'ServerAliveInterval=15',
			'-L',
			`127.0.0.1:${port}:127.0.0.1:${remotePort}`,
			target.ssh!
		],
		{ stdio: 'ignore' }
	);

	state.children.add(child);

	child.once('exit', () => {
		state.children.delete(child);
		closed();
	});

	try {
		await waitOpen(port, child);
	} catch (error) {
		child.kill();
		throw error;
	}

	return `http://127.0.0.1:${port}`;
}

/**
 * The local URL that reaches `base` as the host sees it: `base` itself on
 * this machine, an ssh port forward to it on a remote one. A forward that
 * failed or died is opened again on the next call.
 */
export function reach(target: HostConfig, base: string): Promise<string> {
	if (!target.ssh) return Promise.resolve(base);

	const remotePort = Number(new URL(base).port || 80);
	const key = `${target.id}:${remotePort}`;
	const known = state.urls.get(key);

	if (known) return known;

	const forget = () => state.urls.get(key) === pending && state.urls.delete(key);
	const pending = open(target, remotePort, forget);

	state.urls.set(key, pending);
	pending.catch(forget);

	return pending;
}
