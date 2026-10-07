import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import type { HostConfig } from '$lib/reports/types';

interface Tunnel {
	port: number;
	child: ChildProcess;
	ready: Promise<void>;
}

/**
 * One ssh port forward per remote server, kept open while this app runs. It
 * lives on `globalThis` so a dev-server module reload reuses the open ones.
 */
const tunnels: Map<string, Tunnel> = ((globalThis as { benchTunnels?: Map<string, Tunnel> }).benchTunnels ??=
	new Map());

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

async function open(target: HostConfig, remotePort: number): Promise<Tunnel> {
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

	const tunnel = { port, child, ready: waitOpen(port, child) };

	tunnel.ready.catch(() => child.kill());

	return tunnel;
}

/**
 * The local URL that reaches `base` as the host sees it: `base` itself on
 * this machine, an ssh port forward to it on a remote one. A forward that
 * died is opened again.
 */
export async function reach(target: HostConfig, base: string): Promise<string> {
	if (!target.ssh) return base;

	const url = new URL(base);
	const remotePort = Number(url.port || 80);
	const key = `${target.id}:${remotePort}`;
	let tunnel = tunnels.get(key);

	if (!tunnel || tunnel.child.exitCode !== null) {
		tunnel = await open(target, remotePort);
		tunnels.set(key, tunnel);
	}

	try {
		await tunnel.ready;
	} catch (error) {
		tunnels.delete(key);
		throw error;
	}

	return `http://127.0.0.1:${tunnel.port}`;
}
