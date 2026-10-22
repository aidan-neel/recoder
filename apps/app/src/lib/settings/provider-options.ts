import { promptShown, type AgentAuthMethod, type AgentAuthPrompt, type AgentProvider } from '@recoder/shared';

import { plural } from '../shell/format';

/** Shown first, in this order, while nothing is typed. */
const POPULAR = [
	'opencode',
	'opencode-go',
	'anthropic',
	'openai',
	'github-copilot',
	'openrouter',
	'google',
	'xai',
	'deepseek'
];

/** Providers that list no methods take an API key. */
const KEY_ONLY: AgentAuthMethod = { index: -1, type: 'api', label: 'API key', prompts: [] };

/** One titled run of the provider list; a search shows one run with no title. */
export interface PickGroup {
	heading: string | null;
	items: AgentProvider[];
}

/** Answers to a provider's prompts, by prompt key. */
export type Answers = Record<string, string>;

/** The ways to connect a provider, with a plain API key for providers that list none. */
export function methodsOf(provider: AgentProvider): AgentAuthMethod[] {
	return provider.methods.length ? provider.methods : [KEY_ONLY];
}

/** Popular providers in their fixed order, then everyone else in the agent's order. */
function popularFirst(providers: readonly AgentProvider[]): { popular: AgentProvider[]; rest: AgentProvider[] } {
	const popular = POPULAR.flatMap((id) => providers.filter((provider) => provider.id === id));
	const rest = providers.filter((provider) => !POPULAR.includes(provider.id));

	return { popular, rest };
}

/**
 * The provider list for a search. With nothing typed: "Popular", then "All
 * providers". With a query: every provider whose name or id holds it, popular
 * ones first, under no heading.
 */
export function pickGroups(providers: readonly AgentProvider[], query: string): PickGroup[] {
	const term = query.trim().toLowerCase();

	if (term) {
		const hits = providers.filter(
			(provider) => provider.name.toLowerCase().includes(term) || provider.id.includes(term)
		);

		const { popular, rest } = popularFirst(hits);

		return [{ heading: null, items: [...popular, ...rest] }];
	}

	const { popular, rest } = popularFirst(providers);

	if (popular.length === 0) return [{ heading: null, items: rest }];

	return [
		{ heading: 'Popular', items: popular },
		{ heading: 'All providers', items: rest }
	];
}

/** The method's prompts that apply, given the answers so far. */
export function shownPrompts(method: AgentAuthMethod, answers: Answers): AgentAuthPrompt[] {
	return method.prompts.filter((prompt) => promptShown(prompt, answers));
}

/** A text prompt must be answered unless the agent marks it optional. */
export function missingAnswer(prompts: readonly AgentAuthPrompt[], answers: Answers): boolean {
	return prompts.some(
		(prompt) => prompt.type === 'text' && !/optional/i.test(prompt.message) && !answers[prompt.key]?.trim()
	);
}

/** The answers to send: only prompts that apply, trimmed, with blanks left out. */
export function answersFor(prompts: readonly AgentAuthPrompt[], answers: Answers): Answers {
	const keys = new Set(prompts.map((prompt) => prompt.key));

	return Object.fromEntries(
		Object.entries(answers)
			.filter(([key, value]) => keys.has(key) && value.trim())
			.map(([key, value]) => [key, value.trim()])
	);
}

/** Every select starts on its first option, so a condition on it holds from the start. */
export function firstAnswers(provider: AgentProvider): Answers {
	return Object.fromEntries(
		provider.methods
			.flatMap((method) => method.prompts)
			.flatMap((prompt) =>
				prompt.type === 'select' && prompt.options[0] ? [[prompt.key, prompt.options[0].value]] : []
			)
	);
}

/** "Enter code: AULF-57S8B" → "AULF-57S8B", so a device code can be shown large and copied. */
export function deviceCode(instructions: string): string | null {
	return /code[:\s]+([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+)/i.exec(instructions)?.[1] ?? null;
}

/** How a connected provider is reached, in a few words. */
function viaLabel(via: AgentProvider['via'], agent: string): string {
	if (via === 'key') return 'API key';
	if (via === 'oauth') return 'Signed in';
	if (via === 'config') return `From ${agent} config`;
	if (via === 'env') return 'From environment';

	return 'Free tier';
}

/** "84 models · API key". */
export function describeProvider(provider: AgentProvider, agent: string): string {
	return `${plural(provider.modelCount, 'model')} · ${viaLabel(provider.via, agent)}`;
}

/** "84 models" for a provider in the list, or nothing when it reports none. */
export function modelCount(provider: AgentProvider): string | null {
	return provider.modelCount ? plural(provider.modelCount, 'model') : null;
}
