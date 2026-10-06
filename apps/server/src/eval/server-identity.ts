import { availableParallelism, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { probeVersion } from '../agents/opencode/opencode-server';
import { agentStatuses } from '../agents/registry';
import { CHECKPOINT_VERSION } from '../review/session/review-checkpoint';
import { REVIEW_POLICY } from '../review/session/review-policy';
import { resolveLimits } from '../sandbox/host-load';
import { headCommit } from './harness-tree';
import { UNKNOWN, type ServerCache } from './identity';
import { fileVersion, sourceVersion } from './source-hash';

/** Variables that place the server's files or reach its model, and never change what a review does. */
const NOT_FLAGS = new Set([
	'RECODER_DATA_DIR',
	'RECODER_WORKDIR',
	'RECODER_OPENCODE_BIN',
	'RECODER_REVIEW_API_KEY',
	'RECODER_REVIEW_BASE_URL'
]);

/** A name that holds a key, an endpoint or a host path, by its suffix; never recorded. */
const HIDDEN = /_(KEY|TOKEN|SECRET|PASSWORD|URL|BIN|DIR|PATH)$/;

/** The sandbox's sizing follows the host's capacity, so it is recorded with the host and never compared. */
const HOST_FLAGS = new Set([
	'RECODER_SANDBOX_PREP',
	'RECODER_SANDBOX_RUNS',
	'RECODER_SANDBOX_CPUS',
	'RECODER_SANDBOX_MIN_FREE_MB'
]);

/**
 * Every `RECODER_*` variable that is set, so a switch is recorded the day it
 * is added, split into the flags that change what a review does and the
 * host's sandbox sizing. Keys, endpoints and paths never are.
 */
export function capturedEnv(env: NodeJS.ProcessEnv): { flags: Record<string, string>; host: Record<string, string> } {
	const names = Object.keys(env)
		.filter((name) => name.startsWith('RECODER_') && env[name] !== undefined)
		.filter((name) => !NOT_FLAGS.has(name) && !HIDDEN.test(name))
		.sort();

	const pick = (host: boolean) =>
		Object.fromEntries(names.filter((name) => HOST_FLAGS.has(name) === host).map((name) => [name, env[name]!]));

	return { flags: pick(false), host: pick(true) };
}

/** What the server runs with, as `GET /health/identity` answers. */
export interface ServerIdentity {
	flags: Record<string, string>;
	policy: Record<string, number>;
	caches: Record<string, string>;
	tools: { bun: string; node: string; opencode: string };
	/** The machine, unnamed: the route answers anyone who can reach it, and the harness records its own hostname. */
	host: {
		os: string;
		arch: string;
		cpus: number;
		sandbox: Record<string, number>;
		/** The `RECODER_SANDBOX_*` sizing variables that are set. */
		sandboxFlags: Record<string, string>;
	};
	/** The content hash of the server's and shared sources and lockfiles, as the harness hashes its own. */
	code: string;
	/** The commit the server's checkout is on, `unknown` outside git; recorded, never compared. */
	commit: string;
}

const moduleVersion = (path: string) => fileVersion(fileURLToPath(new URL(path, import.meta.url)));

/**
 * The intent, rule-ledger and baseline caches keep their format numbers
 * private, so their version is the content hash of the module that owns the
 * format, read as the server loads: any change to how it keys or stores
 * entries changes it.
 */
const caches = {
	intent: moduleVersion('../review/pipeline/intent/distill.ts'),
	'rule-ledger': moduleVersion('../review/guidelines/ledger/ledger.ts'),
	'baseline-cache': moduleVersion('../review/pipeline/harness/baseline-cache.ts'),
	'review-checkpoint': `v${CHECKPOINT_VERSION}`
} satisfies Record<ServerCache, string>;

/** The `node` on the server's PATH, which the sandboxed checks run with; `unknown` only when it would not say. */
async function nodeVersion(): Promise<string> {
	const path = Bun.which('node');

	if (!path) return 'not installed';

	return (await probeVersion(path, process.env).catch(() => null)) || UNKNOWN;
}

async function opencodeVersion(): Promise<string> {
	const status = (await agentStatuses().catch(() => [])).find((agent) => agent.id === 'opencode');

	if (status && !status.installed) return 'not installed';

	return status?.version ?? UNKNOWN;
}

export async function serverIdentity(): Promise<ServerIdentity> {
	const cpus = availableParallelism();
	const env = capturedEnv(process.env);

	return {
		flags: env.flags,
		policy: { ...REVIEW_POLICY },
		caches,
		tools: { bun: Bun.version, node: await nodeVersion(), opencode: await opencodeVersion() },
		host: {
			os: `${process.platform} ${release()}`,
			arch: process.arch,
			cpus,
			sandbox: { ...resolveLimits(cpus, process.env) },
			sandboxFlags: env.host
		},
		code: sourceVersion(),
		commit: headCommit(import.meta.dir) ?? UNKNOWN
	};
}
