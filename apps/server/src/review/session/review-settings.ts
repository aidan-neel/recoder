import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
	DEFAULT_SUBAGENT_CAP,
	DEFAULT_TOKEN_BUDGET,
	REASONING_EFFORTS,
	SUBAGENT_CAPS,
	migrateSubagentCap,
	TOKEN_BUDGETS,
	type ModelEntryPatch,
	type ModelSettingsPatch,
	type SubagentCap,
	type TokenBudget
} from '@recoder/shared';
import { serverDataDir } from '../../util/data-dir.js';
import { readSharedSetting, sharedSettingsActive, writeSharedSetting } from '../../config/shared-settings.js';

const runtimeSchema = z.object({
	temperature: z.number().min(0).max(2).nullable().optional(),
	maxOutputTokens: z.number().int().positive().max(1_000_000).optional(),
	topP: z.number().gt(0).max(1).optional()
});

const modelEntrySchema = z.object({
	provider: z.enum(['openai-compatible', 'codex']).optional(),
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

export const reviewSettingsSchema = z.object({
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional(),
	models: z.array(modelEntrySchema).max(50).optional(),
	sharedModelId: z.string().max(100).nullable().optional(),
	orchestratorModelId: z.string().max(100).nullable().optional(),
	specialistModelId: z.string().max(100).nullable().optional(),
	orchestratorEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
	specialistEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
	subagentCap: z.literal(SUBAGENT_CAPS).optional(),
	tokenBudget: z.enum(TOKEN_BUDGETS).optional(),
	reportLowSeverity: z.boolean().optional(),
	maxFiles: z.number().int().positive().max(200).optional(),
	maxDiffChars: z.number().int().positive().max(1_000_000).optional(),
	maxFileChars: z.number().int().positive().max(200_000).optional()
});

export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>;

/**
 * Saved files from before models were just Review and a second model carried per-role picks,
 * and files from before subagents carried a specialist dispatch level.
 */
const storedFileSchema = reviewSettingsSchema.extend({
	subagentCap: z.union([z.literal(SUBAGENT_CAPS), z.number().int().nonnegative()]).optional(),
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

/** Whether the saved cap is one that no longer exists (2 or 4, from before the caps were 3, 8 and 12). */
function hasRetiredCap(data: StoredFile): boolean {
	return data.subagentCap !== undefined && migrateSubagentCap(data.subagentCap) !== data.subagentCap;
}

/** Whether a saved file still holds fields that `migrateLegacy` rewrites, so it is saved again in the new shape. */
function hasLegacyFields(data: StoredFile): boolean {
	return (
		hasRetiredCap(data) ||
		[data.roles, data.roleEfforts, data.applyToSpecialists, data.specialistDispatch].some(
			(field) => field !== undefined
		)
	);
}

/**
 * Old per-role picks become one second-model pick: correctness (always ran) speaks for them all.
 * An old dispatch level becomes the subagent cap it stands for, and a cap that no longer exists the nearest one.
 */
function migrateLegacy(data: StoredFile): ReviewSettingsInput {
	const { roles, roleEfforts, applyToSpecialists, specialistDispatch, subagentCap, ...rest } = data;
	const next: ReviewSettingsInput = { ...rest };

	if (subagentCap !== undefined) next.subagentCap = migrateSubagentCap(subagentCap);
	else if (specialistDispatch) next.subagentCap = CAP_FOR_DISPATCH[specialistDispatch];

	if (next.orchestratorEffort === undefined && roleEfforts?.correctness)
		next.orchestratorEffort = roleEfforts.correctness;

	if (!applyToSpecialists) {
		if (!next.specialistModelId && roles?.correctness) next.specialistModelId = roles.correctness;
		if (next.specialistEffort === undefined && roleEfforts?.correctness)
			next.specialistEffort = roleEfforts.correctness;
	}

	return next;
}

/** A saved model entry: the settings patch's entry, always with an id. */
export interface StoredModelEntry extends ModelEntryPatch {
	id: string;
}

interface StoredSettings extends Omit<ModelSettingsPatch, 'models'> {
	/** API keys for hosted providers, by provider id. */
	connections?: Record<string, { apiKey: string }>;
	models?: StoredModelEntry[];
}

/** Reviewer model settings saved from the UI. They win over process env; unset fields fall back to env. */
let localOverrides: StoredSettings = {};

const sharedStoredSchema = reviewSettingsSchema.extend({
	models: z.array(modelEntrySchema.extend({ id: z.string().min(1).max(100) })).optional(),
	connections: z.record(z.string().max(40), z.object({ apiKey: z.string().min(1).max(500) })).optional()
});

function currentOverrides(): StoredSettings {
	return sharedSettingsActive() ? sharedStoredSchema.parse(readSharedSetting('review-settings') ?? {}) : localOverrides;
}

function replaceOverrides(settings: StoredSettings): void {
	if (sharedSettingsActive()) writeSharedSetting('review-settings', settings);
	else localOverrides = settings;
}

function settingsFile(): string {
	return `${serverDataDir()}/review-config.json`;
}

/** Where overrides are saved, with the home directory shortened to `~`. */
export function settingsFileDisplay(): string {
	if (sharedSettingsActive()) return 'shared database';

	const home = process.env.HOME ?? process.env.USERPROFILE;
	const file = settingsFile();

	return home && file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

function persist(): void {
	if (sharedSettingsActive()) {
		writeSharedSetting('review-settings', currentOverrides());

		return;
	}

	try {
		writeFileSync(settingsFile(), JSON.stringify(currentOverrides(), null, 2), { mode: 0o600 });
	} catch (err) {
		console.warn('[settings] could not persist review config', err instanceof Error ? err.message : err);
	}
}

/** What a saved settings file holds, converted to the current shape, and whether it was in an older one. */
interface SavedSettings {
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

	return { settings: apiKey ? { ...normalized, apiKey } : normalized, legacy: hasLegacyFields(parsed) };
}

function readSavedSettings(): SavedSettings | null {
	try {
		return parseSavedReviewSettings(JSON.parse(readFileSync(settingsFile(), 'utf8')));
	} catch {
		return null;
	}
}

/**
 * Load persisted settings into memory, and save a file that was in an older format again in the current one. Call once
 * at boot. A missing or corrupt file starts empty, and env covers it.
 */
export function initReviewSettings(): void {
	if (sharedSettingsActive()) {
		currentOverrides();

		return;
	}

	const saved = readSavedSettings();

	if (!saved) return;

	replaceOverrides(saved.settings);
	if (saved.legacy) persist();
}

/**
 * Load persisted settings into memory and write nothing, an older file included: it is read in the current shape and
 * left as it is. For a command line that only reads the user's settings.
 */
export function readReviewSettings(): void {
	if (sharedSettingsActive()) {
		currentOverrides();

		return;
	}

	const saved = readSavedSettings();

	if (saved) replaceOverrides(saved.settings);
}

/** Test helper: replace the in-memory overrides. */
export function setReviewOverrides(next: StoredSettings): void {
	replaceOverrides(next);
}

/** Read-only access to the stored settings (server-side only). */
export function getStoredSettings(): StoredSettings {
	return currentOverrides();
}

/** Save or drop a hosted provider's key. Dropping it also removes that provider's models. */
export function setConnection(providerId: string, apiKey: string | null): StoredSettings {
	const current = currentOverrides();
	const connections = { ...current.connections };

	if (apiKey) connections[providerId] = { apiKey };
	else delete connections[providerId];
	replaceOverrides({ ...current, connections });

	if (!apiKey && current.models?.some((entry) => entry.source === providerId)) {
		return saveReviewSettings({ models: current.models.filter((entry) => entry.source !== providerId) });
	}

	persist();

	return currentOverrides();
}

/**
 * A saved model entry from the UI's version and the stored one it replaces. An empty key keeps the
 * stored key and new entries store what was given; hosted-provider entries use the provider's
 * connected key instead.
 */
function mergeModelEntry(
	entry: z.infer<typeof modelEntrySchema>,
	kept: StoredModelEntry | undefined
): StoredModelEntry {
	const next: StoredModelEntry = {
		provider: entry.provider ?? kept?.provider ?? 'openai-compatible',
		id: entry.id ?? crypto.randomUUID(),
		label: entry.label,
		model: entry.model
	};

	const source = entry.source ?? kept?.source;

	if (source && next.provider !== 'codex') next.source = source;

	const baseUrl = entry.baseUrl?.replace(/\/$/, '');

	if (baseUrl && next.provider !== 'codex' && !next.source) next.baseUrl = baseUrl;
	if (entry.efforts?.length) next.efforts = entry.efforts;
	if (entry.defaultEffort) next.defaultEffort = entry.defaultEffort;

	const contextWindow = entry.contextWindow ?? kept?.contextWindow;

	if (contextWindow) next.contextWindow = contextWindow;

	const runtime = entry.runtime ?? kept?.runtime;

	if (runtime && Object.keys(runtime).length) next.runtime = runtime;

	if (next.provider !== 'codex' && !next.source) {
		if (entry.apiKey) next.apiKey = entry.apiKey;
		else if (kept?.apiKey) next.apiKey = kept.apiKey;
	}

	return next;
}

/** Drop routing pointers to model entries that no longer exist. */
function dropDeletedRoutes(settings: StoredSettings, models: StoredModelEntry[]): void {
	const ids = new Set(models.map((e) => e.id));

	if (settings.sharedModelId && !ids.has(settings.sharedModelId)) delete settings.sharedModelId;
	if (settings.orchestratorModelId && !ids.has(settings.orchestratorModelId)) delete settings.orchestratorModelId;
	if (settings.specialistModelId && !ids.has(settings.specialistModelId)) delete settings.specialistModelId;
}

/** Merge a validated patch over the stored settings and persist. */
export function saveReviewSettings(patch: ReviewSettingsInput): StoredSettings {
	const clean: StoredSettings = { ...currentOverrides() };

	if (patch.baseUrl !== undefined) clean.baseUrl = patch.baseUrl.replace(/\/$/, '') || undefined;
	if (patch.apiKey !== undefined && patch.apiKey !== '') clean.apiKey = patch.apiKey;

	if (patch.models !== undefined) {
		const previous = new Map((clean.models ?? []).map((e) => [e.id, e]));

		clean.models = patch.models.map((entry) => mergeModelEntry(entry, entry.id ? previous.get(entry.id) : undefined));
		dropDeletedRoutes(clean, clean.models);
	}

	if (patch.sharedModelId !== undefined) {
		clean.sharedModelId = patch.sharedModelId || null;
	}

	if (patch.orchestratorModelId !== undefined) clean.orchestratorModelId = patch.orchestratorModelId || null;
	if (patch.specialistModelId !== undefined) clean.specialistModelId = patch.specialistModelId || null;
	if (patch.orchestratorEffort !== undefined) clean.orchestratorEffort = patch.orchestratorEffort;
	if (patch.specialistEffort !== undefined) clean.specialistEffort = patch.specialistEffort;
	if (patch.subagentCap !== undefined) clean.subagentCap = patch.subagentCap;
	if (patch.tokenBudget !== undefined) clean.tokenBudget = patch.tokenBudget;
	if (patch.reportLowSeverity !== undefined) clean.reportLowSeverity = patch.reportLowSeverity;
	if (patch.maxFiles !== undefined) clean.maxFiles = patch.maxFiles;
	if (patch.maxDiffChars !== undefined) clean.maxDiffChars = patch.maxDiffChars;
	if (patch.maxFileChars !== undefined) clean.maxFileChars = patch.maxFileChars;
	replaceOverrides(clean);
	persist();

	return clean;
}

function pick(stored: string | undefined, envValue: string | undefined): string {
	if (stored !== undefined && stored !== '') return stored;

	return envValue ?? '';
}

function pickNumber(stored: number | undefined, envValue: string | undefined, fallback: number): number {
	if (stored !== undefined) return stored;

	const parsed = Number(envValue);

	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Effective reviewer env: stored UI settings win, process env is the fallback. */
export function effectiveReviewEnv(): {
	baseUrl: string;
	apiKey: string;
	model: string;
	maxFiles: number;
	maxDiffChars: number;
	maxFileChars: number;
} {
	const overrides = currentOverrides();
	const entries = overrides.models ?? [];
	const shared = entries.find((e) => e.id === overrides.sharedModelId) ?? entries[0];

	return {
		baseUrl: pick(overrides.baseUrl, process.env.RECODER_REVIEW_BASE_URL).replace(/\/$/, ''),
		apiKey: pick(overrides.apiKey, process.env.RECODER_REVIEW_API_KEY),
		model: shared?.model ?? pick(undefined, process.env.RECODER_REVIEW_MODEL),
		maxFiles: pickNumber(overrides.maxFiles, process.env.RECODER_REVIEW_MAX_FILES, 20),
		maxDiffChars: pickNumber(overrides.maxDiffChars, process.env.RECODER_REVIEW_MAX_DIFF_CHARS, 60000),
		maxFileChars: pickNumber(overrides.maxFileChars, process.env.RECODER_REVIEW_MAX_FILE_CHARS, 12000)
	};
}

/** How many subagents one review may run: the saved pick, else the default. */
export function effectiveSubagentCap(): SubagentCap {
	return currentOverrides().subagentCap ?? DEFAULT_SUBAGENT_CAP;
}

/** The token budget last picked, else Medium, which is what reviews did before budgets existed. */
export function effectiveTokenBudget(): TokenBudget {
	return currentOverrides().tokenBudget ?? DEFAULT_TOKEN_BUDGET;
}

/** Whether reviews report low-severity findings: the saved pick, else on. */
export function effectiveReportLowSeverity(): boolean {
	return currentOverrides().reportLowSeverity ?? true;
}

/** API keys are never returned in full; the UI gets this masked preview (`••••1234` or null). */
export function maskKey(key: string | undefined): string | null {
	if (!key) return null;

	return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}
