/** How model ids and sizes read in the UI. Shared by apps/web and apps/app. */

/** Lowercase name parts that have a fixed spelling. */
const SPELLINGS: Record<string, string> = {
	gpt: 'GPT',
	glm: 'GLM',
	oss: 'OSS',
	deepseek: 'DeepSeek',
	minimax: 'MiniMax',
	openai: 'OpenAI',
	xai: 'xAI',
	ai: 'AI',
	moe: 'MoE',
	vl: 'VL'
};

/** A release date (`20251001`) or a moving alias adds nothing to the name. */
const DROPPED = /^(\d{8}|latest)$/i;

/** `35b`, `128k`, `1.5m`: a size, upper-cased. */
const SIZE = /^\d+(\.\d+)?[bkm]$/i;

/** `k2`, `v3.1`, `a3b`, `r1`: a letter-led version, upper-cased. */
const LETTER_VERSION = /^[a-z]\d+(\.\d+)?[a-z]?$/i;

/** Recoder's agent prefixes on model ids (`opencode:openrouter/…`, `claude-code:…`, `devin:…`). */
const AGENT_PREFIX = /^(opencode|claude-code|devin):/;

/** One part of a name, spelled the way people write it. */
function spell(part: string): string {
	const lower = part.toLowerCase();

	if (SPELLINGS[lower]) return SPELLINGS[lower];
	if (SIZE.test(part) || LETTER_VERSION.test(part)) return part.toUpperCase();
	if (/^\d/.test(part) || /[A-Z]/.test(part.slice(1))) return part;

	return part[0].toUpperCase() + part.slice(1);
}

/**
 * A model id as people say it: `glm-5.3-flash` → "GLM 5.3 Flash",
 * `anthropic/claude-haiku-4-5-20251001` → "Claude Haiku 4.5". A provider prefix
 * (and Recoder's agent prefix, `opencode:`) is dropped, and two bare numbers in a
 * row read as one version.
 */
export function prettyModelName(id: string): string {
	const tail = (id.replace(AGENT_PREFIX, '').split('/').pop() ?? id).replace(/:.*$/, '');
	const parts = tail.split(/[-_\s]+/).filter((part) => part && !DROPPED.test(part));
	const merged: string[] = [];

	for (const part of parts) {
		const previous = merged.at(-1);

		if (previous && /^\d+$/.test(previous) && /^\d+$/.test(part) && part.length <= 2) {
			merged[merged.length - 1] = `${previous}.${part}`;
		} else merged.push(part);
	}

	return merged.map(spell).join(' ') || id;
}

/** A label that is still a raw id (no spaces, joined with dashes, slashes or underscores). */
export function looksLikeModelId(label: string): boolean {
	return !/\s/.test(label) && /[-_/]/.test(label);
}

/** 200000 → "200K", 1000000 → "1M": decimal units, the way providers advertise context windows. */
export function formatContextWindow(tokens: number): string {
	const thousands = Math.round(tokens / 1000);

	if (thousands < 1000) return `${thousands}K`;

	return `${Math.round(tokens / 100_000) / 10}M`;
}
