import { readFileSync, writeFileSync } from 'node:fs';
import {
	DEFAULT_SUBAGENT_CAP,
	DEFAULT_TOKEN_BUDGET,
	isRoutedModelId,
	type ModelPolicy,
	type SubagentCap,
	type TokenBudget
} from '@recoder/shared';
import { SealedValueError } from '../../secrets/seal.js';
import { SecretKeyError } from '../../secrets/secret-key.js';
import { serverDataDir } from '../../util/data-dir.js';
import { sharedSettingsActive, writeSharedSetting } from '../../config/shared-settings.js';
import { hasUnsealedKey, openSettingsKeys, sealSettingsKeys } from './settings-secrets.js';
import {
	parseSavedReviewSettings,
	sharedStoredForm,
	type ReviewEntryInput,
	type ReviewSettingsInput,
	type SavedSettings,
	type StoredModelEntry,
	type StoredSettings
} from './review-settings-schema.js';

export { parseSavedReviewSettings, reviewSettingsSchema } from './review-settings-schema.js';
export type { ReviewSettingsInput, StoredModelEntry } from './review-settings-schema.js';

/** Reviewer model settings saved from the UI. They win over process env; unset fields fall back to env. */
let localOverrides: StoredSettings = {};

function currentOverrides(): StoredSettings {
	return sharedSettingsActive() ? openSettingsKeys(sharedStoredForm()) : localOverrides;
}

function replaceOverrides(settings: StoredSettings): void {
	if (sharedSettingsActive()) writeSharedSetting('review-settings', sealSettingsKeys(settings));
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

/** Save the settings with their API keys sealed. */
function persist(): void {
	const sealed = sealSettingsKeys(currentOverrides());

	if (sharedSettingsActive()) {
		writeSharedSetting('review-settings', sealed);

		return;
	}

	try {
		writeFileSync(settingsFile(), JSON.stringify(sealed, null, 2), { mode: 0o600 });
	} catch (err) {
		console.warn('[settings] could not persist review config', err instanceof Error ? err.message : err);
	}
}

function readSavedSettings(): SavedSettings | null {
	try {
		return parseSavedReviewSettings(JSON.parse(readFileSync(settingsFile(), 'utf8')));
	} catch (error) {
		if (error instanceof SealedValueError || error instanceof SecretKeyError) throw error;

		return null;
	}
}

/**
 * Load persisted settings into memory, and save a file that was in an older format, or held keys that were never
 * sealed, again in the current one. Call once at boot. A missing or corrupt file starts empty, and env covers it; keys
 * that cannot be opened stop the start, since saving over them would lose them.
 */
export function initReviewSettings(): void {
	if (sharedSettingsActive()) {
		const stored = sharedStoredForm();
		const settings = openSettingsKeys(stored);

		if (hasUnsealedKey(stored)) replaceOverrides(settings);

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
function mergeModelEntry(entry: ReviewEntryInput, kept: StoredModelEntry | undefined): StoredModelEntry {
	const next: StoredModelEntry = {
		provider: entry.provider ?? kept?.provider ?? 'openai-compatible',
		id: entry.id ?? crypto.randomUUID(),
		label: entry.label,
		model: entry.model
	};

	const source = entry.source ?? kept?.source;

	if (source) next.source = source;

	const baseUrl = entry.baseUrl?.replace(/\/$/, '');

	if (baseUrl && !next.source) next.baseUrl = baseUrl;
	if (entry.efforts?.length) next.efforts = entry.efforts;
	if (entry.defaultEffort) next.defaultEffort = entry.defaultEffort;

	const contextWindow = entry.contextWindow ?? kept?.contextWindow;

	if (contextWindow) next.contextWindow = contextWindow;

	const runtime = entry.runtime ?? kept?.runtime;

	if (runtime && Object.keys(runtime).length) next.runtime = runtime;

	if (!next.source) {
		if (entry.apiKey) next.apiKey = entry.apiKey;
		else if (kept?.apiKey) next.apiKey = kept.apiKey;
	}

	return next;
}

/** Drop routing pointers to stored model entries that no longer exist, keeping agent and vLLM routed ids. */
function dropDeletedRoutes(settings: StoredSettings, models: StoredModelEntry[]): void {
	const ids = new Set(models.map((e) => e.id));
	const keep = (id: string | null | undefined) => !id || ids.has(id) || isRoutedModelId(id);

	if (!keep(settings.sharedModelId)) delete settings.sharedModelId;
	if (!keep(settings.orchestratorModelId)) delete settings.orchestratorModelId;
	if (!keep(settings.specialistModelId)) delete settings.specialistModelId;
	if (!keep(settings.verifierModelId)) delete settings.verifierModelId;
}

/**
 * Merge a patch's context windows over the saved ones: a model set again overwrites its window and `null` removes
 * its key. A `null` that a saved document kept (it is only ever valid in a patch) counts as unset.
 */
function mergeContextWindows(
	saved: Record<string, number | null> | undefined,
	patch: Record<string, number | null>
): Record<string, number> {
	const windows: Record<string, number> = {};

	for (const [id, tokens] of Object.entries(saved ?? {})) if (typeof tokens === 'number') windows[id] = tokens;

	for (const [id, tokens] of Object.entries(patch)) {
		if (tokens === null) delete windows[id];
		else windows[id] = tokens;
	}

	return windows;
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
	if (patch.verifierModelId !== undefined) clean.verifierModelId = patch.verifierModelId || null;
	if (patch.orchestratorEffort !== undefined) clean.orchestratorEffort = patch.orchestratorEffort;
	if (patch.specialistEffort !== undefined) clean.specialistEffort = patch.specialistEffort;
	if (patch.verifierEffort !== undefined) clean.verifierEffort = patch.verifierEffort;
	if (patch.subagentCap !== undefined) clean.subagentCap = patch.subagentCap;
	if (patch.tokenBudget !== undefined) clean.tokenBudget = patch.tokenBudget;
	if (patch.reportLowSeverity !== undefined) clean.reportLowSeverity = patch.reportLowSeverity;
	if (patch.disabledProviders !== undefined) clean.disabledProviders = patch.disabledProviders;
	if (patch.hiddenModels !== undefined) clean.hiddenModels = patch.hiddenModels;
	if (patch.modelPolicy !== undefined) clean.modelPolicy = patch.modelPolicy;
	if (patch.contextWindows !== undefined)
		clean.contextWindows = mergeContextWindows(clean.contextWindows, patch.contextWindows);
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
		maxFiles: pickNumber(overrides.maxFiles, process.env.RECODER_REVIEW_MAX_FILES, 200),
		maxDiffChars: pickNumber(overrides.maxDiffChars, process.env.RECODER_REVIEW_MAX_DIFF_CHARS, 600000),
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

/** The keys of the providers switched off in Settings (`cli:codex`, `opencode:anthropic`); none by default. */
export function disabledProviderKeys(): string[] {
	return [...(currentOverrides().disabledProviders ?? [])];
}

/** The ids of the models switched off in Settings; none by default. */
export function hiddenModelIds(): string[] {
	return [...(currentOverrides().hiddenModels ?? [])];
}

/** Who picks the models members run on: the saved policy, else each member picks. */
export function effectiveModelPolicy(): ModelPolicy {
	return currentOverrides().modelPolicy ?? { kind: 'choose' };
}

/** The context windows the user set, by model id; empty when none is set. */
export function effectiveContextWindows(): Record<string, number> {
	const saved = currentOverrides().contextWindows;

	if (!saved) return {};

	return Object.fromEntries(
		Object.entries(saved).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
	);
}
