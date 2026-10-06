import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ModelEntry, ModelSettings, ReasoningEffort } from '@recoder/shared';
import { localGit } from '../forge/local/git';
import { localRepoPath, readLocalForge, type LocalForge } from '../forge/local/schema';
import { JUDGE_VERSION } from './benchmark-judge';
import type { Adjudications } from './benchmark-labels';
import type { JudgeModel } from './benchmark-report';
import type { TreeState } from './harness-tree';
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
	/** The harness tree, null outside a git checkout. */
	tree: TreeState | null;
	settings: ModelSettings;
	judge: JudgeModel;
	/** What `GET /health/identity` answered; null from a server older than the route. */
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

function stageModel(
	entry: ModelEntry | undefined,
	fallback: string,
	effort: ReasoningEffort | null | undefined
): StageModel {
	return {
		model: entry?.model ?? (fallback || UNKNOWN),
		provider: entry ? (entry.provider ?? 'openai-compatible') : UNKNOWN,
		effort: effort ?? 'default',
		sampling: entry?.runtime ?? 'default',
		contextSize: entry?.contextWindow ?? UNKNOWN,
		weightRevision: UNKNOWN,
		quantization: UNKNOWN
	};
}

/** The two review stages' models as the server resolves them: an unset second model follows the review model and its effort. */
function stageModels(settings: ModelSettings): Pick<RunIdentity['models'], 'orchestrator' | 'specialist'> {
	const entry = (id: string | null | undefined) => settings.models.find((candidate) => candidate.id === id);
	const review = entry(settings.orchestratorModelId ?? settings.sharedModelId);
	const second = settings.specialistModelId;

	return {
		orchestrator: stageModel(review, settings.model, settings.orchestratorEffort),
		specialist: second
			? stageModel(entry(second), second, settings.specialistEffort)
			: stageModel(review, settings.model, settings.specialistEffort ?? settings.orchestratorEffort)
	};
}

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
			host: { name: UNKNOWN, os: UNKNOWN, arch: UNKNOWN, cpus: UNKNOWN, sandbox: UNKNOWN, serverCommit: UNKNOWN },
			code: UNKNOWN
		};

	return {
		flags: server.flags,
		policy: server.policy,
		caches: server.caches,
		tools: server.tools,
		host: { ...server.host, serverCommit: server.tree?.commit ?? UNKNOWN },
		code: server.tree ? contentHash(server.tree) : UNKNOWN
	};
}

/** Everything that decides this benchmark's result, read from the dataset, the forges, the settings and the server. */
export async function captureIdentity(input: IdentityInput): Promise<RunIdentity> {
	const forge = forgeReader();
	const { settings, judge } = input;
	const server = serverParts(input.server);

	return withHash({
		dataset: await datasetIdentity(input.dataset, input.adjudications, forge),
		code: { harness: input.tree ? contentHash(input.tree) : UNKNOWN, server: server.code },
		models: { ...stageModels(settings), seed: UNKNOWN },
		judge: {
			model: judge.model,
			provider: judge.provider,
			effort: judge.effort ?? 'default',
			version: JUDGE_VERSION,
			seed: UNKNOWN
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
		execution: input.execution
	});
}
