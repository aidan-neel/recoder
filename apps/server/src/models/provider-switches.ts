import { providerKey, providersOfModel, type ModelEntry, type ProviderRef } from '@recoder/shared';
import { opencode } from '../agents/opencode/opencode.js';
import { agentById } from '../agents/registry.js';
import { disabledProviderKeys, hiddenModelIds } from '../review/session/review-settings.js';

/** Which providers Settings → Providers has switched off, as one read of the settings found them. */
export interface ProviderSwitches {
	/** Whether the provider is switched on. */
	isOn(ref: ProviderRef): boolean;
	/**
	 * The first provider that runs model `id` and is switched off, the agent CLI before the provider OpenCode routes
	 * the model to; null when every one is on.
	 */
	offProviderOf(modelId: string): ProviderRef | null;
	/** The entries whose models run only on switched-on providers, hidden models included: what the model chooser lists. */
	onlySwitchedOn<T extends Pick<ModelEntry, 'id'>>(entries: readonly T[]): T[];
	/** Whether the admin hid the model in Settings. A hidden model leaves the pickers and cannot be newly picked. */
	isHidden(modelId: string): boolean;
	/** {@link ProviderSwitches.onlySwitchedOn} without the hidden models: what every model picker may offer. */
	onlyPickable<T extends Pick<ModelEntry, 'id'>>(entries: readonly T[]): T[];
}

/**
 * The switches as the settings hold them now. Read them once, before a request or run awaits anything: a shared
 * settings snapshot closes when its request ends, and a slow agent listing can outlast it.
 */
export function providerSwitches(): ProviderSwitches {
	const off = new Set(disabledProviderKeys());
	const hidden = new Set(hiddenModelIds());
	const isOn = (ref: ProviderRef): boolean => !off.has(providerKey(ref));

	const offProviderOf = (modelId: string): ProviderRef | null =>
		providersOfModel(modelId).find((ref) => !isOn(ref)) ?? null;

	return {
		isOn,
		offProviderOf,
		onlySwitchedOn: (entries) => entries.filter((entry) => offProviderOf(entry.id) === null),
		isHidden: (modelId) => hidden.has(modelId),
		onlyPickable: (entries) => entries.filter((entry) => offProviderOf(entry.id) === null && !hidden.has(entry.id))
	};
}

/** What Settings → Providers calls the provider: the agent CLI's name, or the name OpenCode gives its provider. */
export function providerName(ref: ProviderRef): string {
	if (ref.kind === 'opencode') return opencode.providerName(ref.id);

	return agentById(ref.id)?.name ?? ref.id;
}
