import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { ReasoningEffort } from '@recoder/shared';
import { serverDataDir } from './data-dir.js';
import type { ReviewRole } from './models.js';
import { REVIEW_ROLES } from './roles.js';

/**
 * Reviewer model settings, editable from the UI and persisted to disk.
 * Stored overrides win over process env; unset fields fall back to env.
 * The API key is never returned in full — only a masked preview.
 */

const roleSettingsSchema = z.object({
	security: z.string().max(200).optional(),
	perf: z.string().max(200).optional(),
	correctness: z.string().max(200).optional(),
	docs: z.string().max(200).optional(),
	dedup: z.string().max(200).optional(),
	patterns: z.string().max(200).optional(),
	testing: z.string().max(200).optional(),
	errors: z.string().max(200).optional(),
	concurrency: z.string().max(200).optional(),
	api: z.string().max(200).optional()
});

const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

const modelEntrySchema = z.object({
	provider: z.enum(['openai-compatible', 'codex']).optional(),
	id: z.string().max(100).optional(),
	label: z.string().min(1).max(100),
	model: z.string().min(1).max(200),
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional(),
	efforts: z.array(z.enum(REASONING_EFFORTS)).max(8).optional()
});

export const reviewSettingsSchema = z.object({
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional(),
	models: z.array(modelEntrySchema).max(50).optional(),
	sharedModelId: z.string().max(100).nullable().optional(),
	orchestratorModelId: z.string().max(100).nullable().optional(),
	specialistModelId: z.string().max(100).nullable().optional(),
	roles: roleSettingsSchema.optional(),
	roleEfforts: z.partialRecord(z.enum(REVIEW_ROLES), z.enum(REASONING_EFFORTS)).optional(),
	maxFiles: z.number().int().positive().max(200).optional(),
	maxDiffChars: z.number().int().positive().max(1_000_000).optional(),
	maxFileChars: z.number().int().positive().max(200_000).optional()
});

export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>;

export interface StoredModelEntry {
	provider?: 'openai-compatible' | 'codex';
	id: string;
	label: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
	efforts?: ReasoningEffort[];
}

interface StoredSettings {
	baseUrl?: string;
	apiKey?: string;
	models?: StoredModelEntry[];
	sharedModelId?: string | null;
	orchestratorModelId?: string | null;
	specialistModelId?: string | null;
	roles?: Partial<Record<ReviewRole, string>>;
	roleEfforts?: Partial<Record<ReviewRole, ReasoningEffort>>;
	maxFiles?: number;
	maxDiffChars?: number;
	maxFileChars?: number;
}

let overrides: StoredSettings = {};

function settingsFile(): string {
	return `${serverDataDir()}/review-config.json`;
}

function persist(): void {
	try {
		writeFileSync(settingsFile(), JSON.stringify(overrides, null, 2), { mode: 0o600 });
	} catch (err) {
		console.warn('[settings] could not persist review config', err instanceof Error ? err.message : err);
	}
}

/** Load persisted settings into memory. Call once at boot. */
export function initReviewSettings(): void {
	try {
		const raw = readFileSync(settingsFile(), 'utf8');
		const parsed = reviewSettingsSchema.safeParse(JSON.parse(raw));
		if (parsed.success) {
			const { apiKey, models, ...rest } = parsed.data;
			const normalized: StoredSettings = {
				...rest,
				models: models?.map((e) => ({
					provider: e.provider,
					id: e.id ?? crypto.randomUUID(),
					label: e.label,
					model: e.model,
					...(e.baseUrl ? { baseUrl: e.baseUrl } : {}),
					...(e.apiKey ? { apiKey: e.apiKey } : {}),
					...(e.efforts?.length ? { efforts: e.efforts } : {})
				}))
			};
			overrides = apiKey ? { ...normalized, apiKey } : normalized;
		}
	} catch {
		// Missing or corrupt file → start empty (env fallback covers it).
	}
}

/** Test helper: replace the in-memory overrides. */
export function setReviewOverrides(next: StoredSettings): void {
	overrides = next;
}

/** Read-only access to the stored settings (server-side only). */
export function getStoredSettings(): StoredSettings {
	return overrides;
}

/** Merge a validated patch over the stored settings and persist. */
export function saveReviewSettings(patch: ReviewSettingsInput): StoredSettings {
	const clean: StoredSettings = { ...overrides };
	if (patch.baseUrl !== undefined) clean.baseUrl = patch.baseUrl.replace(/\/$/, '') || undefined;
	if (patch.apiKey !== undefined && patch.apiKey !== '') clean.apiKey = patch.apiKey;
	if (patch.models !== undefined) {
		const previous = new Map((clean.models ?? []).map((e) => [e.id, e]));
		clean.models = patch.models.map((entry) => {
			const kept = entry.id ? previous.get(entry.id) : undefined;
			const next: StoredModelEntry = {
				provider: entry.provider ?? kept?.provider ?? 'openai-compatible',
				id: entry.id ?? crypto.randomUUID(),
				label: entry.label,
				model: entry.model
			};
			const baseUrl = entry.baseUrl?.replace(/\/$/, '');
			if (baseUrl && next.provider !== 'codex') next.baseUrl = baseUrl;
			if (entry.efforts?.length) next.efforts = entry.efforts;
			// Empty key keeps the existing entry key; new entries store what was given.
			if (next.provider !== 'codex') {
				if (entry.apiKey) next.apiKey = entry.apiKey;
				else if (kept?.apiKey) next.apiKey = kept.apiKey;
			}
			return next;
		});
		// Drop routing pointers to deleted entries.
		const ids = new Set(clean.models.map((e) => e.id));
		if (clean.sharedModelId && !ids.has(clean.sharedModelId)) delete clean.sharedModelId;
		if (clean.orchestratorModelId && !ids.has(clean.orchestratorModelId)) delete clean.orchestratorModelId;
		if (clean.specialistModelId && !ids.has(clean.specialistModelId)) delete clean.specialistModelId;
		if (clean.roles) {
			for (const role of REVIEW_ROLES) {
				if (clean.roles[role] && !ids.has(clean.roles[role] as string)) delete clean.roles[role];
			}
		}
	}
	if (patch.sharedModelId !== undefined) {
		clean.sharedModelId = patch.sharedModelId || null;
	}
	if (patch.orchestratorModelId !== undefined) clean.orchestratorModelId = patch.orchestratorModelId || null;
	if (patch.specialistModelId !== undefined) clean.specialistModelId = patch.specialistModelId || null;
	if (patch.roles !== undefined) {
		clean.roles = { ...(clean.roles ?? {}) };
		for (const role of REVIEW_ROLES) {
			const value = patch.roles[role];
			if (value !== undefined) {
				if (value === '') delete clean.roles[role];
				else clean.roles[role] = value;
			}
		}
		if (Object.keys(clean.roles).length === 0) delete clean.roles;
	}
	if (patch.roleEfforts !== undefined) clean.roleEfforts = { ...clean.roleEfforts, ...patch.roleEfforts };
	if (patch.maxFiles !== undefined) clean.maxFiles = patch.maxFiles;
	if (patch.maxDiffChars !== undefined) clean.maxDiffChars = patch.maxDiffChars;
	if (patch.maxFileChars !== undefined) clean.maxFileChars = patch.maxFileChars;
	overrides = clean;
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
	roles: Partial<Record<ReviewRole, string>>;
	maxFiles: number;
	maxDiffChars: number;
	maxFileChars: number;
} {
	const entries = overrides.models ?? [];
	const shared = entries.find((e) => e.id === overrides.sharedModelId) ?? entries[0];
	return {
		baseUrl: pick(overrides.baseUrl, process.env.RECODER_REVIEW_BASE_URL).replace(/\/$/, ''),
		apiKey: pick(overrides.apiKey, process.env.RECODER_REVIEW_API_KEY),
		model: shared?.model ?? pick(undefined, process.env.RECODER_REVIEW_MODEL),
		roles: Object.fromEntries(
			REVIEW_ROLES.map((role) => [
				role,
				pick(overrides.roles?.[role], process.env[`RECODER_${role.toUpperCase()}_MODEL`]) ||
					undefined
			])
		) as Partial<Record<ReviewRole, string>>,
		maxFiles: pickNumber(overrides.maxFiles, process.env.RECODER_REVIEW_MAX_FILES, 20),
		maxDiffChars: pickNumber(
			overrides.maxDiffChars,
			process.env.RECODER_REVIEW_MAX_DIFF_CHARS,
			60000
		),
		maxFileChars: pickNumber(
			overrides.maxFileChars,
			process.env.RECODER_REVIEW_MAX_FILE_CHARS,
			12000
		)
	};
}

/** Masked key preview for the UI (`••••1234` or null). */
export function apiKeyPreview(): string | null {
	const key = effectiveReviewEnv().apiKey;
	if (!key) return null;
	return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}
