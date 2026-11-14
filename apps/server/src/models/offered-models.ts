import type { ModelEntry } from '@recoder/shared';
import { agentModels, pickedModels } from '../agents/registry';
import { getStoredSettings } from '../review/session/review-settings';
import { providerSwitches } from './provider-switches';
import { vllmEntries } from './vllm/vllm-models';

/**
 * How long a write waits on an agent's fresh model listing (after the lists were cleared) before it answers with the
 * models that agent listed last. The listing goes on and fills the cache for the next read; a write never waits out a
 * slow CLI.
 */
export const WRITE_WAIT_MS = 2_500;

/** Which of the models the server lists a reader wants. */
export type ModelListing =
	/** The models people pick from: every one on a switched-on provider that the admin has not hidden. */
	| { kind: 'pickable' }
	/** The model chooser's list: every model on a switched-on provider, hidden ones included. */
	| { kind: 'chooser' }
	/** Only the models the settings have picked, for a page that shows the picks but no picker. */
	| { kind: 'picked' };

/**
 * The models the settings offer: the captured vLLM models, then every model the agents run, narrowed as `listing`
 * says. Models on a provider switched off in Settings are always left out, picked ones too, and a hidden model is
 * left out of the pickable list unless it is a saved pick, so the picker can still name it. `waitMs` bounds the wait
 * on a fresh listing.
 */
export async function offeredModels(listing: ModelListing, waitMs?: number): Promise<ModelEntry[]> {
	const switches = providerSwitches();

	if (listing.kind === 'chooser') return switches.onlySwitchedOn(await listedModels(waitMs));

	const { sharedModelId, orchestratorModelId, specialistModelId, verifierModelId } = getStoredSettings();
	const picked = [sharedModelId, orchestratorModelId, specialistModelId, verifierModelId];

	if (listing.kind === 'pickable') {
		const listed = await listedModels(waitMs);

		return switches.onlySwitchedOn(listed).filter((entry) => !switches.isHidden(entry.id) || picked.includes(entry.id));
	}

	return switches.onlySwitchedOn([
		...vllmEntries().filter((entry) => picked.includes(entry.id)),
		...(await pickedModels(picked, waitMs))
	]);
}

/** Every model the server lists, whatever the switches say: the captured vLLM models and every agent's. */
export async function listedModels(waitMs?: number): Promise<ModelEntry[]> {
	return [...vllmEntries(), ...(await agentModels(waitMs))];
}
