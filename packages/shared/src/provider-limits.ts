import { agentCliOfModel } from './agent-clis';

/**
 * One entry of Settings' Providers list: an agent CLI (`cli`, by its adapter id) or a model provider OpenCode
 * connects (`opencode`, by OpenCode's provider id, such as `opencode-go` or `anthropic`).
 */
export interface ProviderRef {
	kind: 'cli' | 'opencode';
	id: string;
}

/**
 * The provider's key: `cli:<agent id>` or `opencode:<provider id>`. Settings saves switched-off providers by this
 * key, and the limits route takes it as its path parameter.
 */
export function providerKey(ref: ProviderRef): string {
	return `${ref.kind}:${ref.id}`;
}

/** The provider a key names, or null for a key in neither form. */
export function parseProviderKey(key: string): ProviderRef | null {
	const colon = key.indexOf(':');
	const kind = key.slice(0, colon);
	const id = key.slice(colon + 1);

	if (colon < 1 || !id || (kind !== 'cli' && kind !== 'opencode')) return null;

	return { kind, id };
}

/** One usage window a provider meters, as its account reports it. */
export interface UsageWindow {
	/** What the provider calls the window, kept short: `5-hour`, `Weekly`, `Weekly Opus`, `Monthly`. */
	label: string;
	/** How much of the window is used, 0 to 100. */
	usedPercent: number;
	/** When the window resets (ISO time); null when the provider does not say. */
	resetsAt: string | null;
}

/**
 * `GET /api/agent/limits/:key`: a provider's usage limits. `ready` carries the windows its account reports;
 * `signed-out` means the provider needs a sign-in before it has limits to read; `unsupported` means Recoder has
 * no way to read this provider's limits; `error` means reading them failed, with a reason fit to show.
 */
export type ProviderLimits =
	| {
			status: 'ready';
			/** The plan the account is on, as the provider names it (`Max 20x`, `Plus`); null when unknown. */
			plan: string | null;
			windows: UsageWindow[];
			/** When the server read these limits (ISO time); reads are cached for a minute. */
			checkedAt: string;
	  }
	| { status: 'signed-out' }
	| { status: 'unsupported' }
	| { status: 'error'; reason: string };

/**
 * The providers that run model `id`: its agent CLI (`<agent id>:<model>`), and for an OpenCode model
 * (`opencode:<provider>/<model>`) also the provider OpenCode routes it to. None for a model no agent CLI runs (a saved
 * endpoint or a vLLM model), which no switch covers.
 */
export function providersOfModel(id: string): ProviderRef[] {
	const cli = agentCliOfModel(id);

	if (!cli) return [];

	const ref: ProviderRef = { kind: 'cli', id: cli.id };
	const model = id.slice(cli.id.length + 1);
	const slash = model.indexOf('/');

	if (cli.id !== 'opencode' || slash < 1) return [ref];

	return [ref, { kind: 'opencode', id: model.slice(0, slash) }];
}

/** The first provider that runs model `id` and is in `disabled` (provider keys), the agent CLI first; null when all are on. */
export function switchedOffProviderOf(id: string, disabled: readonly string[]): ProviderRef | null {
	return providersOfModel(id).find((ref) => disabled.includes(providerKey(ref))) ?? null;
}
