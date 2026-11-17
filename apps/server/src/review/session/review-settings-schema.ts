/**
 * The saved shape of the reviewer model settings: the schemas a saved file or
 * shared-settings row must satisfy, the migrations that bring an older shape
 * forward, and the parse that turns a saved document into current settings.
 * The store that reads and writes these lives in `review-settings.ts`.
 */

import { z } from 'zod';
import {
	MAX_CONTEXT_WINDOW,
	MAX_SUBAGENT_CAP,
	MIN_CONTEXT_WINDOW,
	REASONING_EFFORTS,
	TOKEN_BUDGETS,
	parseProviderKey,
	type ModelEntryPatch,
	type ModelSettingsPatch,
	type SubagentCap
} from '@recoder/shared';
import { readSharedSetting } from '../../config/shared-settings.js';
import { isChatGptSignInEntry, moveChatGptModels, SAVED_ENTRY_PROVIDERS } from './chatgpt-migration.js';
import { hiddenModelsSchema, modelPolicySchema } from './model-pick-schemas.js';
import { hasUnsealedKey, openSettingsKeys } from './settings-secrets.js';

const runtimeSchema = z.object({
	temperature: z.number().min(0).max(2).nullable().optional(),
	maxOutputTokens: z.number().int().positive().max(1_000_000).optional(),
	topP: z.number().gt(0).max(1).optional()
});

const modelEntrySchema = z.object({
	provider: z.literal('openai-compatible').optional(),
	/** Hosted provider id; the entry uses that provider's endpoint and connected key. */
	source: z.string().max(40).optional(),
	id: z.string().max(100).optional(),
	label: z.string().min(1).max(100),
	model: z.string().min(1).max(200),
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional(),
	efforts: z.array(z.enum(REASONING_EFFORTS)).max(8).optional(),
	defaultEffort: z.enum(REASONING_EFFORTS).optional(),
	contextWindow: z.number().int().positive().max(100_000_000).optional(),
	runtime: runtimeSchema.optional()
});

/** A model entry as a save sends it, before it is given its id. */
export type ReviewEntryInput = z.infer<typeof modelEntrySchema>;

/**
 * The context windows a user set, by model id. A `null` value is how a patch
 * removes a model's key; a saved document never keeps one, since saving merges
 * the patch and drops the key instead.
 */
const contextWindowsSchema = z.record(
	z.string().max(200),
	z.number().int().min(MIN_CONTEXT_WINDOW).max(MAX_CONTEXT_WINDOW).nullable()
);

/**
 * The providers switched off in Settings, by `providerKey`, kept deduplicated and sorted. A key no installed CLI or
 * connected provider has yet is kept: the CLI may be installed again, and its switch should still hold.
 */
const disabledProvidersSchema = z
	.array(
		z
			.string()
			.max(200)
			.refine((key) => parseProviderKey(key) !== null, 'Expected cli:<agent id> or opencode:<provider id>.')
	)
	.max(200)
	.transform((keys) => [...new Set(keys)].sort());

/** A count from 0 to {@link MAX_SUBAGENT_CAP}, or `'uncapped'`. */
const subagentCapSchema = z.union([z.number().int().min(0).max(MAX_SUBAGENT_CAP), z.literal('uncapped')]);

export const reviewSettingsSchema = z.object({
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional(),
	models: z.array(modelEntrySchema).max(50).optional(),
	sharedModelId: z.string().max(100).nullable().optional(),
	orchestratorModelId: z.string().max(100).nullable().optional(),
	specialistModelId: z.string().max(100).nullable().optional(),
	verifierModelId: z.string().max(100).nullable().optional(),
	orchestratorEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
	specialistEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
	verifierEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
	subagentCap: subagentCapSchema.optional(),
	tokenBudget: z.enum(TOKEN_BUDGETS).optional(),
	reportLowSeverity: z.boolean().optional(),
	disabledProviders: disabledProvidersSchema.optional(),
	hiddenModels: hiddenModelsSchema.optional(),
	modelPolicy: modelPolicySchema.optional(),
	contextWindows: contextWindowsSchema.optional(),
	maxFiles: z.number().int().positive().max(200).optional(),
	maxDiffChars: z.number().int().positive().max(1_000_000).optional(),
	maxFileChars: z.number().int().positive().max(200_000).optional()
});

export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>;

/** A saved entry, which may be one from before the Codex CLI that used Recoder's own ChatGPT sign-in. */
const savedEntrySchema = modelEntrySchema.extend({ provider: z.enum(SAVED_ENTRY_PROVIDERS).optional() });

/**
 * Saved files from before models were just Review and a second model carried per-role picks, files from before
 * subagents carried a specialist dispatch level, and files from before the Codex CLI carried ChatGPT entries.
 */
const storedFileSchema = reviewSettingsSchema.extend({
	models: z.array(savedEntrySchema).max(50).optional(),
	connections: z.record(z.string().max(40), z.object({ apiKey: z.string().min(1).max(500) })).optional(),
	roles: z.record(z.string().max(40), z.string().max(200)).optional(),
	roleEfforts: z.record(z.string().max(40), z.enum(REASONING_EFFORTS)).optional(),
	applyToSpecialists: z.boolean().optional(),
	specialistDispatch: z.enum(['low', 'medium', 'high']).optional()
});

type StoredFile = z.infer<typeof storedFileSchema>;

/** The subagent cap each old dispatch level stands for. */
const CAP_FOR_DISPATCH: Record<NonNullable<StoredFile['specialistDispatch']>, SubagentCap> = {
	low: 0,
	medium: 3,
	high: 8
};

/**
 * Old per-role picks become one second-model pick: correctness (always ran) speaks for them all.
 * An old dispatch level becomes the subagent cap it stands for.
 * A ChatGPT entry leaves the list, and each pick of one names the same model through the Codex CLI.
 */
function migrateLegacy(data: StoredFile): ReviewSettingsInput {
	const { roles, roleEfforts, applyToSpecialists, specialistDispatch, subagentCap, models, ...rest } = data;
	const next: ReviewSettingsInput = { ...rest };

	if (subagentCap !== undefined) next.subagentCap = subagentCap;
	else if (specialistDispatch) next.subagentCap = CAP_FOR_DISPATCH[specialistDispatch];

	if (next.orchestratorEffort === undefined && roleEfforts?.correctness)
		next.orchestratorEffort = roleEfforts.correctness;

	if (!applyToSpecialists) {
		if (!next.specialistModelId && roles?.correctness) next.specialistModelId = roles.correctness;
		if (next.specialistEffort === undefined && roleEfforts?.correctness)
			next.specialistEffort = roleEfforts.correctness;
	}

	return { ...next, ...moveChatGptModels(next, models) };
}

/** Whether a saved file still holds fields that `migrateLegacy` rewrites, so it is saved again in the new shape. */
function hasLegacyFields(data: StoredFile): boolean {
	return (
		!!data.models?.some(isChatGptSignInEntry) ||
		[data.roles, data.roleEfforts, data.applyToSpecialists, data.specialistDispatch].some(
			(field) => field !== undefined
		)
	);
}

/** A saved model entry: the settings patch's entry, always with an id. */
export interface StoredModelEntry extends ModelEntryPatch {
	id: string;
}

export interface StoredSettings extends Omit<ModelSettingsPatch, 'models'> {
	/** API keys for hosted providers, by provider id. */
	connections?: Record<string, { apiKey: string }>;
	models?: StoredModelEntry[];
}

/**
 * The shared settings as stored, their keys sealed or not, in the current shape: a ChatGPT entry saved before the
 * Codex CLI moves as in a file.
 */
const sharedStoredSchema = reviewSettingsSchema.extend({
	models: z.array(savedEntrySchema.extend({ id: z.string().min(1).max(100) })).optional(),
	connections: z.record(z.string().max(40), z.object({ apiKey: z.string().min(1).max(500) })).optional()
});

/** The shared settings as stored, converted to the current shape with their keys as saved. */
export function sharedStoredForm(): StoredSettings {
	const { models, ...rest } = sharedStoredSchema.parse(readSharedSetting('review-settings') ?? {});

	return { ...rest, ...moveChatGptModels(rest, models) };
}

/**
 * What a saved settings file holds, converted to the current shape with its keys opened, and whether it was in an
 * older one: before the shapes above, or before keys were sealed.
 */
export interface SavedSettings {
	settings: StoredSettings;
	legacy: boolean;
}

/** Parse a saved settings document and migrate its model identifiers and retired configuration fields. */
export function parseSavedReviewSettings(raw: unknown): SavedSettings {
	const parsed = storedFileSchema.parse(raw);
	const { apiKey, models, ...rest } = migrateLegacy(parsed);

	const normalized: StoredSettings = {
		...rest,
		...(parsed.connections ? { connections: parsed.connections } : {}),
		models: models?.map((e) => ({
			provider: e.provider,
			...(e.source ? { source: e.source } : {}),
			id: e.id ?? crypto.randomUUID(),
			label: e.label,
			model: e.model,
			...(e.baseUrl ? { baseUrl: e.baseUrl } : {}),
			...(e.apiKey ? { apiKey: e.apiKey } : {}),
			...(e.efforts?.length ? { efforts: e.efforts } : {}),
			...(e.defaultEffort ? { defaultEffort: e.defaultEffort } : {}),
			...(e.contextWindow ? { contextWindow: e.contextWindow } : {}),
			...(e.runtime && Object.keys(e.runtime).length ? { runtime: e.runtime } : {})
		}))
	};

	const stored = apiKey ? { ...normalized, apiKey } : normalized;

	return { settings: openSettingsKeys(stored), legacy: hasLegacyFields(parsed) || hasUnsealedKey(stored) };
}
