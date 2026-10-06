import { availableParallelism, hostname, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { probeVersion } from '../agents/opencode/opencode-server';
import { agentStatuses } from '../agents/registry';
import { CHECKPOINT_VERSION } from '../review/session/review-checkpoint';
import { REVIEW_POLICY } from '../review/session/review-policy';
import { resolveLimits } from '../sandbox/host-load';
import { headCommit } from './harness-tree';
import { UNKNOWN, type ServerCache } from './identity';
import { fileVersion, sourceVersion } from './source-hash';

/**
 * The environment switches that change what a review does. Only these are
 * read, never every `RECODER_*` variable, so no key and no host path is
 * recorded. `RECODER_OBLIGATIONS` is listed before any code reads it.
 */
const FLAGS = [
	'RECODER_TEST_STRENGTH',
	'RECODER_OBLIGATIONS',
	'RECODER_LLM_CONCURRENCY',
	'RECODER_LLM_RETRIES',
	'RECODER_LLM_IDLE_MS',
	'RECODER_BASELINE_CACHE',
	'RECODER_EXEC',
	'RECODER_OVERLAY',
	'RECODER_REVIEW_EXCLUDE'
];

/** What the server runs with, as `GET /health/identity` answers. */
export interface ServerIdentity {
	flags: Record<string, string>;
	policy: Record<string, number>;
	caches: Record<string, string>;
	tools: { bun: string; node: string; opencode: string };
	host: {
		name: string;
		os: string;
		arch: string;
		cpus: number;
		sandbox: Record<string, number>;
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

	return {
		flags: Object.fromEntries(FLAGS.map((name) => [name, process.env[name] ?? 'unset'])),
		policy: { ...REVIEW_POLICY },
		caches,
		tools: { bun: Bun.version, node: await nodeVersion(), opencode: await opencodeVersion() },
		host: {
			name: hostname(),
			os: `${process.platform} ${release()}`,
			arch: process.arch,
			cpus,
			sandbox: { ...resolveLimits(cpus, process.env) }
		},
		code: sourceVersion(),
		commit: headCommit(import.meta.dir) ?? UNKNOWN
	};
}
