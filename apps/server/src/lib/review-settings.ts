import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { ReviewRole } from './models.js';

/**
 * Reviewer model settings, editable from the UI and persisted to disk.
 * Stored overrides win over process env; unset fields fall back to env.
 * The API key is never returned in full — only a masked preview.
 */

const roleSettingsSchema = z.object({
	security: z.string().max(200).optional(),
	perf: z.string().max(200).optional(),
	correctness: z.string().max(200).optional(),
	docs: z.string().max(200).optional()
});

const modelEntrySchema = z.object({
	id: z.string().max(100).optional(),
	label: z.string().min(1).max(100),
	model: z.string().min(1).max(200),
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional()
});

export const reviewSettingsSchema = z.object({
	baseUrl: z.string().max(500).optional(),
	apiKey: z.string().max(500).optional(),
	models: z.array(modelEntrySchema).max(50).optional(),
	sharedModelId: z.string().max(100).nullable().optional(),
	roles: roleSettingsSchema.optional(),
	maxFiles: z.number().int().positive().max(200).optional(),
	maxDiffChars: z.number().int().positive().max(1_000_000).optional(),
	maxFileChars: z.number().int().positive().max(200_000).optional()
});

export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>;

export interface StoredModelEntry {
	id: string;
	label: string;
	model: string;
	baseUrl?: string;
	apiKey?: string;
}

interface StoredSettings {
	baseUrl?: string;
	apiKey?: string;
	models?: StoredModelEntry[];
	sharedModelId?: string | null;
	roles?: Partial<Record<ReviewRole, string>>;
	maxFiles?: number;
	maxDiffChars?: number;
	maxFileChars?: number;
}

let overrides: StoredSettings = {};

function settingsFile(): string {
	const dir = process.env.RECODER_DATA_DIR ?? './data';
	mkdirSync(dir, { recursive: true });
	return `${dir}/review-config.json`;
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
					id: e.id ?? crypto.randomUUID(),
					label: e.label,
					model: e.model,
					...(e.baseUrl ? { baseUrl: e.baseUrl } : {}),
					...(e.apiKey ? { apiKey: e.apiKey } : {})
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
				id: entry.id ?? crypto.randomUUID(),
				label: entry.label,
				model: entry.model
			};
			const baseUrl = entry.baseUrl?.replace(/\/$/, '');
			if (baseUrl) next.baseUrl = baseUrl;
			// Empty key keeps the existing entry key; new entries store what was given.
			if (entry.apiKey) next.apiKey = entry.apiKey;
			else if (kept?.apiKey) next.apiKey = kept.apiKey;
			return next;
		});
		// Drop routing pointers to deleted entries.
		const ids = new Set(clean.models.map((e) => e.id));
		if (clean.sharedModelId && !ids.has(clean.sharedModelId)) delete clean.sharedModelId;
		if (clean.roles) {
			for (const role of ['security', 'perf', 'correctness', 'docs'] as const) {
				if (clean.roles[role] && !ids.has(clean.roles[role] as string)) delete clean.roles[role];
			}
		}
	}
	if (patch.sharedModelId !== undefined) {
		clean.sharedModelId = patch.sharedModelId || null;
	}
	if (patch.roles !== undefined) {
		clean.roles = { ...(clean.roles ?? {}) };
		for (const role of ['security', 'perf', 'correctness', 'docs'] as const) {
			const value = patch.roles[role];
			if (value !== undefined) {
				if (value === '') delete clean.roles[role];
				else clean.roles[role] = value;
			}
		}
		if (Object.keys(clean.roles).length === 0) delete clean.roles;
	}
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
		roles: {
			security: pick(overrides.roles?.security, process.env.RECODER_SECURITY_MODEL) || undefined,
			perf: pick(overrides.roles?.perf, process.env.RECODER_PERF_MODEL) || undefined,
			correctness:
				pick(overrides.roles?.correctness, process.env.RECODER_CORRECTNESS_MODEL) || undefined,
			docs: pick(overrides.roles?.docs, process.env.RECODER_DOCS_MODEL) || undefined
		},
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
