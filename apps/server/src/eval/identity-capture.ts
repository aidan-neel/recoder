import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ModelEntry, ModelSettings, ReasoningEffort } from '@recoder/shared';
import { OPENCODE_MODEL_PREFIX } from '../agents/opencode/opencode-catalog';
import { localGit } from '../forge/local/git';
import { localRepoPath, readLocalForge, type LocalForge } from '../forge/local/schema';
import { JUDGE_VERSION } from './benchmark-judge';
import type { Adjudications } from './benchmark-labels';
import type { JudgeModel } from './benchmark-report';
import { JUDGE_SEED } from './benchmark-scoring';
import {
	SERVER_CACHES,
	UNKNOWN,
	contentHash,
	taskIdOf,
	withHash,
	type RunIdentity,
	type StageModel,
	type TaskIdentity
} from './identity';
import type { ServerIdentity } from './server-identity';
import { sourceVersion } from './source-hash';

/** What the identity reads of a label file. */
interface TaskLabel {
	id: string;
	codebase: string;
	/** The local forge repo's `file://` URL. */
	repo: string;
	pull: number;
	headSha: string;
}

/** What a benchmark knows about itself before it runs. */
export interface IdentityInput {
	/** The dataset directory. */
	dataset: string;
	/** The labeled PRs this benchmark covers. */
	tasks: readonly TaskLabel[];
	adjudications: Adjudications;
	settings: ModelSettings;
	judge: JudgeModel;
	/** What `GET /health/identity` answered; null from a server older than the route, which answers 404. */
	server: ServerIdentity | null;
	execution: RunIdentity['execution'];
}

type ForgeReader = (url: string) => Promise<LocalForge | null>;

/** Reads each forge repo's PR metadata once; null for a repo that is not a readable local forge. */
function forgeReader(): ForgeReader {
	const forges = new Map<string, Promise<LocalForge | null>>();

	return (url) => {
		if (!forges.has(url))
			forges.set(
				url,
				readLocalForge(url).catch(() => null)
			);

		return forges.get(url)!;
	};
}

async function forgeHead(url: string): Promise<string> {
	try {
		return await localGit(localRepoPath(url), ['rev-parse', 'HEAD']);
	} catch {
		return UNKNOWN;
	}
}

/** Every label file in the dataset, `--only` or not, so shards of one dataset share its identity. */
function labelFiles(dataset: string): { name: string; text: string }[] {
	const dir = join(dataset, 'labels');

	return readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

/** The human decisions only: an unresolved entry classifies a finding as no entry does, and the benchmark queues those itself. */
function decided(adjudications: Adjudications): Record<string, string> {
	return Object.fromEntries(
		Object.entries(adjudications)
			.filter(([, entry]) => entry.label !== 'unresolved')
			.map(([key, entry]) => [key, entry.label])
	);
}

async function datasetIdentity(
	dataset: string,
	adjudications: Adjudications,
	forge: ForgeReader
): Promise<RunIdentity['dataset']> {
	const files = labelFiles(dataset);

	const repos = new Map(
		files.map(({ text }) => JSON.parse(text) as TaskLabel).map((label) => [label.codebase, label.repo])
	);

	const forges = await Promise.all(
		[...repos].map(async ([codebase, url]) => {
			const metadata = await forge(url);

			return [codebase, { head: await forgeHead(url), metadata: metadata ? contentHash(metadata) : UNKNOWN }];
		})
	);

	return {
		name: basename(dataset),
		labels: contentHash(files),
		adjudications: contentHash(decided(adjudications)),
		forges: Object.fromEntries(forges)
	};
}

/** Each task with the base commit its forge says the PR was cut from, sorted by task id. */
async function taskIdentities(tasks: readonly TaskLabel[], forge: ForgeReader): Promise<TaskIdentity[]> {
	const identities = await Promise.all(
		tasks.map(async (task) => ({
			taskId: taskIdOf(task.id, task.headSha),
			base: (await forge(task.repo))?.pulls.find((pull) => pull.number === task.pull)?.baseSha ?? UNKNOWN
		}))
	);

	return identities.sort((a, b) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true }));
}

/**
 * One stage's model by its pick. An OpenCode pick names its model and provider
 * even while OpenCode cannot list it; any other pick the settings do not list
 * leaves its provider and context size `unknown`.
 */
function stageModel(
	settings: ModelSettings,
	id: string | null | undefined,
	effort: ReasoningEffort | null | undefined
): StageModel {
	const entry: ModelEntry | undefined = settings.models.find((candidate) => candidate.id === id);
	const opencode = !entry && id?.startsWith(OPENCODE_MODEL_PREFIX);

	return {
		model: entry?.model ?? (opencode ? id!.slice(OPENCODE_MODEL_PREFIX.length) : id || settings.model || UNKNOWN),
		provider: entry ? (entry.provider ?? 'openai-compatible') : opencode ? 'opencode' : UNKNOWN,
		effort: effort ?? 'default',
		sampling: entry?.runtime ?? 'default',
		contextSize: entry ? (entry.contextWindow ?? 'default') : UNKNOWN
	};
}

/** The two review stages' models as the server resolves them: an unset second model follows the review model and its effort. */
function stageModels(settings: ModelSettings): RunIdentity['models'] {
	const review = settings.orchestratorModelId ?? settings.sharedModelId;
	const second = settings.specialistModelId;

	return {
		orchestrator: stageModel(settings, review, settings.orchestratorEffort),
		specialist: second
			? stageModel(settings, second, settings.specialistEffort)
			: stageModel(settings, review, settings.specialistEffort ?? settings.orchestratorEffort)
	};
}

/** No provider reports a model's weight revision or quantization yet; recorded so a local run can fill them. */
const INFERENCE = { weightRevision: UNKNOWN, quantization: UNKNOWN };

/** The server's part of the identity, every field `unknown` when it did not answer. */
function serverParts(server: ServerIdentity | null): Pick<RunIdentity, 'flags' | 'caches' | 'tools' | 'host'> & {
	policy: RunIdentity['limits']['policy'];
	code: string;
} {
	if (!server)
		return {
			flags: UNKNOWN,
			policy: UNKNOWN,
			caches: Object.fromEntries(SERVER_CACHES.map((name) => [name, UNKNOWN])),
			tools: { bun: UNKNOWN, node: UNKNOWN, opencode: UNKNOWN },
			host: {
				name: UNKNOWN,
				os: UNKNOWN,
				arch: UNKNOWN,
				cpus: UNKNOWN,
				sandbox: UNKNOWN,
				sandboxFlags: UNKNOWN,
				serverCommit: UNKNOWN,
				inference: INFERENCE
			},
			code: UNKNOWN
		};

	return {
		flags: server.flags,
		policy: server.policy,
		caches: server.caches,
		tools: server.tools,
		host: { ...server.host, serverCommit: server.commit, inference: INFERENCE },
		code: server.code
	};
}

/** Why parts of the identity are `unknown`: each source that could not be read, with the fields it leaves unknown. */
function unavailable(server: ServerIdentity | null, harness: string): Record<string, string> {
	return {
		...(server
			? server.code === UNKNOWN
				? { 'code.server': 'the server found none of its source files' }
				: {}
			: {
					server:
						'the server has no /health/identity route (HTTP 404), so code.server, flags, limits.policy, caches and tools are unknown'
				}),
		...(harness === UNKNOWN ? { 'code.harness': 'the harness found none of its source files' } : {})
	};
}

/** Everything that decides this benchmark's result, read from the dataset, the forges, the settings and the server. */
export async function captureIdentity(input: IdentityInput): Promise<RunIdentity> {
	const forge = forgeReader();
	const { settings, judge } = input;
	const server = serverParts(input.server);
	const harness = sourceVersion();

	return withHash({
		dataset: await datasetIdentity(input.dataset, input.adjudications, forge),
		code: { harness, server: server.code },
		models: stageModels(settings),
		judge: {
			model: judge.model,
			provider: judge.provider,
			effort: judge.effort ?? 'default',
			version: JUDGE_VERSION,
			seed: JUDGE_SEED
		},
		flags: server.flags,
		limits: {
			settings: {
				subagentCap: settings.subagentCap,
				reportLowSeverity: settings.reportLowSeverity,
				...settings.limits
			},
			policy: server.policy
		},
		caches: { ...server.caches, 'benchmark-judge': `v${JUDGE_VERSION}` },
		tools: server.tools,
		tasks: await taskIdentities(input.tasks, forge),
		host: server.host,
		execution: input.execution,
		unavailable: unavailable(input.server, harness)
	});
}
