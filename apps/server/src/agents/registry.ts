import { agentReady, within, type AgentStatus, type ModelEntry } from '@recoder/shared';
import { TtlCache } from '../util/ttl-cache';
import { claudeCode } from './claude-code/claude-code';
import type { AgentAdapter } from './contract';
import { customCommand } from './custom/custom-command';
import { devin } from './devin/devin';
import { opencode } from './opencode/opencode';

/**
 * Every agent CLI Recoder runs. Adding a CLI is one adapter (see `contract.ts` and
 * `docs/agents/adapter-contract.md`) plus its line here; the routes, Settings, the model routing and the review
 * pipeline read only this list.
 */
const AGENTS: readonly AgentAdapter[] = [opencode, claudeCode, devin, customCommand];

/** Every agent CLI Recoder runs, in the order Settings lists them. */
export function registeredAgents(): readonly AgentAdapter[] {
	return AGENTS;
}

/** The agent whose id is `id` (a model provider), or null for a provider that is not an agent CLI. */
export function agentById(id: string | undefined): AgentAdapter | null {
	return AGENTS.find((agent) => agent.id === id) ?? null;
}

/** The agent that runs model `id` (`<agent id>:<model>`) and the model without that prefix, or null. */
export function agentForModel(id: string): { agent: AgentAdapter; model: string } | null {
	const agent = AGENTS.find((item) => id.startsWith(`${item.id}:`));

	return agent ? { agent, model: id.slice(agent.id.length + 1) } : null;
}

/** What the status of an agent that looks ready says when its models could not be listed. */
const UNLISTED = 'Couldn’t list its models.';

/**
 * How long a failed listing is kept: the reads of one page share it, and an
 * agent that was restarting is asked again within seconds.
 */
const LISTING_FAILURE_MS = 5_000;

/**
 * Each agent's model list. Listing asks the agent (Devin runs its CLI each
 * time), and Settings, first run and the setup check all ask on load. A list
 * is fresh for a minute; past that a read still answers from it at once and
 * lists again behind it. Kept per agent, so a page that shows only the picks
 * waits on just the agents that run them. A change that adds or removes
 * models calls {@link forgetAgentModels}.
 */
const modelsCache = new TtlCache<ModelEntry[]>(60_000, AGENTS.length, LISTING_FAILURE_MS);

/**
 * What each agent's latest listing found: its models, or null when it failed,
 * so its status says so instead of reading as an agent with no models. It
 * outlives the cache's clears (a forge token change, a check), so a read that
 * stops waiting on a fresh listing still answers with the models the agent
 * offered last. A provider change drops it, since it no longer holds.
 */
const listed = new Map<string, ModelEntry[] | null>();

/** Bumped when the lists start over, so a listing that started before does not count. */
let generation = 0;

/**
 * How long a status read waits on a fresh listing before it answers without
 * it. The listing goes on and fills the cache for the next read.
 */
const CHECK_WAIT_MS = 5_000;

/**
 * Every agent's status. One that looks ready but whose latest listing failed
 * reads as unable to run. The read lists such an agent again once its kept
 * failure has gone, and waits for that listing, so an agent that came back
 * reads ready on the same read; a listing still running from an earlier read
 * is not waited on twice. `refresh` checks each agent again and lists its
 * models afresh, so the check also says whether listing works now; while
 * that listing is still slow, the agent keeps what the last one found.
 */
export function agentStatuses(refresh = false): Promise<AgentStatus[]> {
	if (refresh) relist();

	return Promise.all(
		AGENTS.map(async (agent) => {
			const status = await agent.detect(refresh);

			if (!agentReady(status)) return status;
			if (refresh || retryable(agent)) await modelsOf(agent, CHECK_WAIT_MS);

			return listed.get(agent.id) === null ? { ...status, error: UNLISTED } : status;
		})
	);
}

/**
 * True when the agent's latest listing failed and none is running now. Its
 * models read answers the kept failure at once, or lists it again once that
 * has gone.
 */
function retryable(agent: AgentAdapter): boolean {
	return listed.get(agent.id) === null && !modelsCache.loading(agent.id);
}

/**
 * One agent's models, tagged with the agent. One that's missing or down adds
 * none, so Settings still opens, and its status says why. With `waitMs`, a
 * read that waits on a fresh listing answers with the agent's last list once
 * that long passes; the listing goes on and fills the cache for the next read.
 */
function modelsOf(agent: AgentAdapter, waitMs?: number): Promise<ModelEntry[]> {
	const started = generation;
	const fresh = () => started === generation;

	const listing = modelsCache
		.stale(agent.id, async () => (await agent.models()).map((entry) => ({ ...entry, agent: agent.name })))
		.then(
			(entries) => {
				if (fresh()) listed.set(agent.id, entries);

				return entries;
			},
			(): ModelEntry[] => {
				if (fresh()) listed.set(agent.id, null);

				return [];
			}
		);

	return waitMs === undefined ? listing : within(listing, waitMs, listed.get(agent.id) ?? []);
}

/** Every agent's models. `waitMs` bounds the wait on a fresh listing, as in {@link modelsOf}. */
export async function agentModels(waitMs?: number): Promise<ModelEntry[]> {
	return (await Promise.all(AGENTS.map((agent) => modelsOf(agent, waitMs)))).flat();
}

/**
 * The entries of the models `ids` name, as {@link agentModels} lists them.
 * An agent's model ids start with its own id (`opencode:…`, `devin:…`), so
 * only the agents that run a picked model are asked; an id no agent lists
 * (a direct endpoint, or a model gone since it was picked) has no entry.
 */
export async function pickedModels(
	ids: readonly (string | null | undefined)[],
	waitMs?: number
): Promise<ModelEntry[]> {
	const wanted = new Set(ids.filter((id): id is string => !!id));
	const owners = AGENTS.filter((agent) => [...wanted].some((id) => id.startsWith(`${agent.id}:`)));
	const lists = await Promise.all(owners.map((agent) => modelsOf(agent, waitMs)));

	return lists.flat().filter((entry) => wanted.has(entry.id));
}

/** Starts the model lists over: the cached lists go, and a listing already running no longer counts. */
function relist(): void {
	generation++;
	modelsCache.clear();
}

/** Drops the model lists and what the last ones found, after a provider change that adds or removes models. */
export function forgetAgentModels(): void {
	relist();
	listed.clear();
}
