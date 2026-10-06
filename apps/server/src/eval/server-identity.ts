import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { availableParallelism, hostname, release } from 'node:os';
import { probeVersion } from '../agents/opencode/opencode-server';
import { agentStatuses } from '../agents/registry';
import { CHECKPOINT_VERSION } from '../review/session/review-checkpoint';
import { REVIEW_POLICY } from '../review/session/review-policy';
import { resolveLimits } from '../sandbox/host-load';
import { captureTree, type TreeState } from './harness-tree';
import { UNKNOWN, type ServerCache } from './identity';

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
	/** The server's own checkout as it started, which may differ from the harness that asks. */
	tree: TreeState | null;
}

function moduleVersion(path: string): string {
	try {
		const source = readFileSync(new URL(path, import.meta.url));

		return `source:${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
	} catch {
		return UNKNOWN;
	}
}

/**
 * The code the server loaded, read once at startup: a file edited while it
 * runs is not code it runs. The intent, rule-ledger and baseline caches keep
 * their format numbers private, so their version is the content hash of the
 * module that owns the format: any change to how it keys or stores entries
 * changes it.
 */
const loaded = {
	tree: captureTree(import.meta.dir),
	caches: {
		intent: moduleVersion('../review/pipeline/intent/distill.ts'),
		'rule-ledger': moduleVersion('../review/guidelines/ledger/ledger.ts'),
		'baseline-cache': moduleVersion('../review/pipeline/harness/baseline-cache.ts'),
		'review-checkpoint': `v${CHECKPOINT_VERSION}`
	} satisfies Record<ServerCache, string>
};

/** The `node` on the server's PATH, which the sandboxed checks run with. */
async function nodeVersion(): Promise<string> {
	const path = Bun.which('node');

	return (path && (await probeVersion(path, process.env).catch(() => null))) || UNKNOWN;
}

async function opencodeVersion(): Promise<string> {
	const statuses = await agentStatuses().catch(() => []);

	return statuses.find((status) => status.id === 'opencode')?.version ?? UNKNOWN;
}

export async function serverIdentity(): Promise<ServerIdentity> {
	const cpus = availableParallelism();

	return {
		flags: Object.fromEntries(FLAGS.map((name) => [name, process.env[name] ?? 'unset'])),
		policy: { ...REVIEW_POLICY },
		caches: loaded.caches,
		tools: { bun: Bun.version, node: await nodeVersion(), opencode: await opencodeVersion() },
		host: {
			name: hostname(),
			os: `${process.platform} ${release()}`,
			arch: process.arch,
			cpus,
			sandbox: { ...resolveLimits(cpus, process.env) }
		},
		tree: loaded.tree
	};
}
