import { createHash } from 'node:crypto';
import { currentUsageResources } from '../../models/usage-resources';

interface Gate {
	ready: Promise<void>;
	release(): void;
}

/** How long followers wait for the leader's first step; a 15k-token prefill takes about a second. */
const WARM_START_CAP_MS = 5_000;

const reviews = new WeakMap<object, Map<string, Gate>>();

/** A review retains opened keys, but releases every pending timer and waiter when its resources close. */
function reviewGates(): Map<string, Gate> | undefined {
	const resources = currentUsageResources();

	if (!resources) return undefined;

	let gates = reviews.get(resources);

	if (!gates) {
		gates = new Map();
		reviews.set(resources, gates);

		const owned = gates;

		resources.cleanup.push(async () => {
			for (const gate of owned.values()) gate.release();
			owned.clear();
		});
	}

	return gates;
}

/** The first model call gets at most `WARM_START_CAP_MS` to populate the provider's shared prefix cache. */
function newGate(signal: AbortSignal): Gate {
	const { promise: ready, resolve } = Promise.withResolvers<void>();

	const release = () => {
		clearTimeout(timer);
		signal.removeEventListener('abort', release);
		resolve();
	};

	const timer = setTimeout(release, WARM_START_CAP_MS);

	signal.addEventListener('abort', release, { once: true });

	return { ready, release };
}

/** Remove the abort listener as soon as either outcome settles, including for long-lived run signals. */
async function waitForGate(gate: Gate, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();

	const { promise, reject } = Promise.withResolvers<never>();
	const abort = () => reject(signal.reason);

	signal.addEventListener('abort', abort, { once: true });

	try {
		await Promise.race([gate.ready, promise]);
		signal.throwIfAborted();
	} finally {
		signal.removeEventListener('abort', abort);
	}
}

/** Only a session's first prompt participates; followers can never release their leader's gate. */
export class OpenCodeWarmStart {
	private readonly gates;
	private readonly key;
	private started = false;
	private leader?: Gate;

	constructor(root: string | undefined, catalog: string | undefined, system: string) {
		this.gates = root ? reviewGates() : undefined;
		this.key = JSON.stringify([root, catalog, createHash('sha256').update(system).digest('hex')]);
	}

	async wait(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();

		if (this.started || !this.gates) return;

		this.started = true;

		const existing = this.gates.get(this.key);

		if (existing) return waitForGate(existing, signal);

		this.leader = newGate(signal);
		this.gates.set(this.key, this.leader);
	}

	release(): void {
		this.leader?.release();
	}
}
