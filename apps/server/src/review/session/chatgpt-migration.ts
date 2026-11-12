import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CODEX_MODEL_PREFIX } from '../../agents/codex/codex-models.js';

/**
 * The provider a saved model entry had when it ran through Recoder's own, now retired, ChatGPT sign-in. It is the
 * id the Codex CLI adapter has now, but no saved entry may name that adapter: its models are `codex:<model>` picks.
 */
const CHATGPT_SIGN_IN_PROVIDER = 'codex';

/** The providers a saved entry may name: the one entries have now, and the retired ChatGPT sign-in. */
export const SAVED_ENTRY_PROVIDERS = ['openai-compatible', CHATGPT_SIGN_IN_PROVIDER] as const;

/** Every settings field that names a picked model. A field that names a ChatGPT entry is moved to the CLI's id. */
const MODEL_PICK_KEYS = ['sharedModelId', 'orchestratorModelId', 'specialistModelId', 'verifierModelId'] as const;

type ModelPicks = Partial<Record<(typeof MODEL_PICK_KEYS)[number], string | null>>;

/** A saved model entry, as far as the migration reads it. */
interface SavedEntry {
	provider?: (typeof SAVED_ENTRY_PROVIDERS)[number];
	id?: string;
	model: string;
}

/** A saved entry once the migration ran: no longer able to name the ChatGPT sign-in. */
type MovedEntry<E extends SavedEntry> = Omit<E, 'provider'> & { provider?: 'openai-compatible' };

/** True for a saved entry that ran through the retired ChatGPT sign-in. */
export function isChatGptSignInEntry(entry: SavedEntry): boolean {
	return entry.provider === CHATGPT_SIGN_IN_PROVIDER;
}

/**
 * The picks and saved entries with every ChatGPT entry dropped, and each pick that named one naming the same model
 * through the Codex CLI (`codex:<model>`). Run on settings already moved, it changes nothing.
 */
export function moveChatGptModels<E extends SavedEntry>(
	picks: ModelPicks,
	models: E[] | undefined
): ModelPicks & { models?: MovedEntry<E>[] } {
	return { ...movedPicks(picks, models ?? []), ...(models ? { models: withoutChatGpt(models) } : {}) };
}

/** The picks with each one that named a ChatGPT entry naming the same model through the Codex CLI. */
function movedPicks(settings: ModelPicks, models: SavedEntry[]): ModelPicks {
	const moved = new Map(
		models.flatMap((entry) =>
			isChatGptSignInEntry(entry) && entry.id ? [[entry.id, `${CODEX_MODEL_PREFIX}${entry.model}`] as const] : []
		)
	);

	const picks: ModelPicks = {};

	for (const key of MODEL_PICK_KEYS) {
		const id = settings[key];

		if (id !== undefined) picks[key] = (id && moved.get(id)) || id;
	}

	return picks;
}

function withoutChatGpt<E extends SavedEntry>(models: E[]): MovedEntry<E>[] {
	return models.flatMap(({ provider, ...entry }) =>
		provider === CHATGPT_SIGN_IN_PROVIDER ? [] : [{ ...entry, provider }]
	);
}

/**
 * Deletes the ChatGPT sign-in Recoder saved for itself in its data dir, and the older Recoder-owned session it was
 * once imported from. The Codex CLI keeps its own sign-in under `CODEX_HOME`, which this never touches. A file
 * already gone is fine, so a second start changes nothing.
 */
export async function deleteChatGptTokens(dataDir: string): Promise<void> {
	await Promise.all([
		rm(join(dataDir, 'chatgpt-auth.json'), { force: true }),
		rm(join(dataDir, 'codex', 'auth.json'), { force: true })
	]);
}
