import { VLLM_MODEL_PREFIX, isRoutedModelId, type EffortChoices, type ModelEntry } from '@recoder/shared';
import type { AgentAdapter } from '../../agents/contract.js';
import { agentForModel, registeredAgents } from '../../agents/registry.js';
import { vllmEntries } from '../../models/vllm/vllm-models.js';
import { effectiveReviewEnv, getStoredSettings } from '../../review/session/review-settings.js';
import { CliError, EXIT, notReadyError, usageError } from '../exit.js';
import { writeStderrLine } from '../output/streams.js';
import type { RunSignal } from './run-signal.js';

/** Where the ids `--reviewer` and `--worker` accept come from, naming each agent CLI's model id prefix. */
function knownIdsHint(): string {
	const agents = registeredAgents().map((agent) => `${agent.id}:<model>`);

	return `Run recoder models to list the ids this machine accepts: a saved model's id, ${agents.join(', ')} or vllm:<server>/<model>.`;
}

/**
 * How long an agent that lists its models by running (OpenCode, Devin) may take to list them. A healthy first
 * OpenCode lookup took 1.1 s here, so this is generous; the lookup only picks an effort, so it must never hold a
 * review for long.
 */
export const MODEL_LOOKUP_LIMIT_MS = 10_000;

const MS_PER_SECOND = 1000;

/** What a lookup of an agent's models runs under: the run's stop, and how long the lookup may take. */
export interface ModelLookup {
	stop: RunSignal;
	limitMs: number;
}

/** How a lookup ended. The agent's own error text is left out on purpose: it can hold tokens and private paths. */
export type Listing =
	{ kind: 'listed'; models: ModelEntry[] } | { kind: 'failed' } | { kind: 'too-slow' } | { kind: 'stopped' };

/**
 * The agents that list their models only by running: an agent with a fixed list (Claude Code) is known without
 * running anything. OpenCode lists through its server, which a lookup cannot stop; Devin and a custom command run a
 * process, which the signal kills.
 */
function liveAgents(): AgentAdapter[] {
	return registeredAgents().filter((agent) => !agent.fixedModels());
}

/**
 * What the review needs to know of a model it accepts: enough to name it, group it and offer its efforts. A saved
 * entry, a captured vLLM model, a Claude Code model, the environment's model and an agent's model all fit; a saved
 * entry's key is not part of it.
 */
export type KnownModel = Pick<ModelEntry, 'id' | 'label' | 'provider' | 'source' | 'efforts' | 'defaultEffort'> & {
	baseUrl?: string | null;
};

/** A model `--reviewer` and `--worker` accept, with the efforts it offers. */
export interface AcceptedModel {
	entry: KnownModel;
	choices: EffortChoices;
}

/** Every accepted model that could be listed, and one line for each agent that could not list its models. */
export interface AcceptedModels {
	models: AcceptedModel[];
	problems: string[];
}

/**
 * The reasoning efforts a model id the caller named offers. Throws a usage error naming the id when no saved entry,
 * captured vLLM model or agent model has it, and a not-ready error when its agent cannot list its models in time.
 */
export async function namedModelChoices(id: string, lookup: ModelLookup): Promise<EffortChoices> {
	const known = knownModelChoices(id) ?? environmentModelChoices(id) ?? (await namedLiveChoices(id, lookup));

	if (known) return known;

	throw usageError(`Unknown model "${id}". ${knownIdsHint()}${savedIdsHint()}${environmentModelHint()}`);
}

/**
 * Every model `namedModelChoices` accepts, from the same sources: saved entries, captured vLLM models, Claude Code's
 * list, the environment's model, and what the agents that list by running list, each listing under `lookup`. An
 * agent that is not installed is skipped: that is no problem. A listing that fails or is too slow adds a problem,
 * built without the agent's own text, and the other sources are still listed. A stop during the lookup throws as
 * cancelled.
 */
export async function listAcceptedModels(lookup: ModelLookup): Promise<AcceptedModels> {
	const agents = liveAgents().filter((agent) => agent.installed());
	const listings = await Promise.all(agents.map((agent) => listWithin(agent, lookup)));

	if (listings.some((listing) => listing.kind === 'stopped')) {
		throw new CliError('Stopped while listing the models.', EXIT.cancelled);
	}

	const listed = listings.flatMap((listing) => (listing.kind === 'listed' ? listing.models : []));
	const entries: KnownModel[] = [...listedModels(), ...environmentModels(), ...listed];

	return {
		models: uniqueById(entries).map((entry) => ({ entry, choices: choicesOf(entry) })),
		problems: agents.flatMap((agent, index) => problemOf(agent, listings[index], lookup))
	};
}

/** An agent's listing of its models, with the agent's name for messages. */
export interface AgentListing {
	agentName: string;
	listing: Listing;
}

/**
 * Lists the agent behind a model id of an agent that lists its models by running, for a caller that must know
 * whether the agent offers a model. Null for any other id: those need no live lookup.
 */
export async function listLiveModels(id: string, lookup: ModelLookup): Promise<AgentListing | null> {
	const agent = liveAgentOf(id);

	return agent ? { agentName: agent.name, listing: await listWithin(agent, lookup) } : null;
}

/** What a failed or slow listing says about the agent, in words that hold nothing from the agent itself. */
export function listingProblem(listing: Listing, lookup: ModelLookup): string {
	return listing.kind === 'too-slow'
		? `did not list its models within ${lookup.limitMs / MS_PER_SECOND} s`
		: 'could not list its models';
}

/**
 * The efforts of a model already picked in the saved settings; undefined for no pick, and for one whose efforts are
 * unknown, which then runs with no reasoning effort, as the app's pickers show it. A pick of an agent that lists by
 * running is looked up as a named id is, but a lookup that fails or runs out of time must not stop the review over a
 * pick the caller did not make: that is said on standard error and the efforts stay unknown.
 */
export async function savedModelChoices(
	id: string | undefined,
	lookup: ModelLookup
): Promise<EffortChoices | undefined> {
	if (!id) return undefined;

	const known = knownModelChoices(id);
	const agent = liveAgentOf(id);

	if (known || !agent) return known;

	const listing = await listWithin(agent, lookup);

	if (listing.kind === 'listed') return choicesIn(listing.models, id);

	if (listing.kind === 'stopped') throw stoppedDuringLookup(lookup.stop);

	writeStderrLine(
		`recoder: ${agent.name} ${listingProblem(listing, lookup)}, so no reasoning effort is set for "${id}".`
	);

	return undefined;
}

/** The efforts of `id` from what is at hand: saved entries, captured vLLM models and Claude Code's list. */
function knownModelChoices(id: string): EffortChoices | undefined {
	return entryChoices(listedModels().find((entry) => entry.id === id));
}

/**
 * The models known without running anything. An id that starts with the vLLM prefix, or the prefix of an agent with
 * a fixed list, is routed to that list alone, so a saved entry with such an id is never accepted; a captured vLLM
 * model its server no longer serves is not accepted either.
 */
function listedModels(): KnownModel[] {
	const fixedAgents = registeredAgents().filter((agent) => agent.fixedModels());

	const routedToList = (id: string): boolean =>
		id.startsWith(VLLM_MODEL_PREFIX) || fixedAgents.some((agent) => id.startsWith(`${agent.id}:`));

	const saved = (getStoredSettings().models ?? []).filter((entry) => !routedToList(entry.id));
	const fixed = fixedAgents.flatMap((agent) => agent.fixedModels() ?? []);

	return [...saved, ...vllmEntries().filter((entry) => entry.unavailable !== true), ...fixed];
}

/** Some agents list their models only by running the CLI, so they are asked only when no list at hand has the id. */
async function namedLiveChoices(id: string, lookup: ModelLookup): Promise<EffortChoices | undefined> {
	const agent = liveAgentOf(id);

	if (!agent) return undefined;

	if (!agent.installed()) {
		throw notReadyError(
			`Cannot use model "${id}": ${agent.name} is not installed here. Run recoder models to list the ids this machine accepts.`
		);
	}

	const listing = await listWithin(agent, lookup);

	if (listing.kind === 'listed') return choicesIn(listing.models, id);

	if (listing.kind === 'stopped') throw stoppedDuringLookup(lookup.stop);

	throw notReadyError(
		`Cannot check model "${id}": ${agent.name} ${listingProblem(listing, lookup)}. Run recoder doctor to see what is wrong.`
	);
}

/** The agent that runs model `id`, when it lists its models only by running. */
function liveAgentOf(id: string): AgentAdapter | undefined {
	const agent = agentForModel(id)?.agent;

	return agent && !agent.fixedModels() ? agent : undefined;
}

/**
 * Lists the agent's models, giving up when the lookup's limit passes or the run is stopped, and then stopping what the
 * agent can stop (a process it runs). A listing given up on may still end later, and its answer or failure is dropped:
 * nothing waits for it any more.
 */
async function listWithin(agent: AgentAdapter, lookup: ModelLookup): Promise<Listing> {
	const { signal } = lookup.stop;

	if (signal.aborted) return { kind: 'stopped' };

	const givenUp = Promise.withResolvers<Listing>();
	const abandoned = new AbortController();

	const onStop = (): void => {
		abandoned.abort();
		givenUp.resolve({ kind: 'stopped' });
	};

	const timer = setTimeout(() => {
		abandoned.abort();
		givenUp.resolve({ kind: 'too-slow' });
	}, lookup.limitMs);

	signal.addEventListener('abort', onStop, { once: true });

	const listing = agent.models(abandoned.signal).then(
		(models): Listing => ({ kind: 'listed', models }),
		(): Listing => ({ kind: 'failed' })
	);

	try {
		return await Promise.race([listing, givenUp.promise]);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onStop);
	}
}

/** A stop during the lookup ends the run as cancelled, as it would a moment later in the review. */
function stoppedDuringLookup(stop: RunSignal): CliError {
	return new CliError(
		`${stop.stopReason() ?? 'The review was cancelled.'} It was still checking the model's efforts.`,
		EXIT.cancelled
	);
}

function choicesIn(models: ModelEntry[], id: string): EffortChoices | undefined {
	return entryChoices(models.find((entry) => entry.id === id));
}

function savedIdsHint(): string {
	const ids = (getStoredSettings().models ?? []).map((entry) => entry.id);

	return ids.length ? ` Saved models: ${ids.join(', ')}.` : '';
}

function entryChoices(entry: Pick<ModelEntry, 'efforts' | 'defaultEffort'> | undefined): EffortChoices | undefined {
	return entry && choicesOf(entry);
}

function choicesOf(entry: Pick<ModelEntry, 'efforts' | 'defaultEffort'>): EffortChoices {
	return { efforts: entry.efforts?.length ? entry.efforts : null, defaultEffort: entry.defaultEffort ?? null };
}

/** The first entry of each id: the order the sources are asked in decides which one a named id gets. */
function uniqueById(entries: readonly KnownModel[]): KnownModel[] {
	return entries.filter((entry, index) => entries.findIndex((other) => other.id === entry.id) === index);
}

/** One line for an agent whose listing did not come back; nothing for one that did. */
function problemOf(agent: AgentAdapter, listing: Listing, lookup: ModelLookup): string[] {
	return listing.kind === 'listed' ? [] : [`${agent.name} ${listingProblem(listing, lookup)}`];
}

/**
 * With no saved models, the environment names the one model reviews run on (`RECODER_REVIEW_MODEL`), and a caller can
 * name it as it is. It has no id of its own and offers no effort levels. Saved models replace it, so it is no choice then.
 */
function environmentModelChoices(id: string): EffortChoices | undefined {
	return entryChoices(environmentModels().find((entry) => entry.id === id));
}

/** The environment's model as an entry named by its own id; none when saved models replace it or the id is routed. */
function environmentModels(): KnownModel[] {
	const model = environmentModel();

	if (model === null || isRoutedModelId(model)) return [];

	return [{ id: model, label: model, provider: 'openai-compatible', baseUrl: effectiveReviewEnv().baseUrl || null }];
}

function environmentModelHint(): string {
	const model = environmentModel();

	return model === null ? '' : ` The environment's model is ${model}.`;
}

function environmentModel(): string | null {
	if (getStoredSettings().models?.length) return null;

	return effectiveReviewEnv().model || null;
}
