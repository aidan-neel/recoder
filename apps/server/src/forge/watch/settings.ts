import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
	AUTO_REVIEW_INTERVALS,
	DEFAULT_AUTO_REVIEW_SETTINGS,
	FINDING_SEVERITIES,
	MAX_INLINE_COMMENTS,
	type AutoReviewSettings
} from '@recoder/shared';
import { readSharedSetting, sharedSettingsActive, writeSharedSetting } from '../../config/shared-settings.js';
import { serverDataDir } from '../../util/data-dir.js';

/** A handle is one `@word`: no spaces, so it can be matched as a whole word in a comment. */
const handleSchema = z
	.string()
	.trim()
	.regex(/^@[\w.-]{1,60}$/, 'The handle is one word starting with @, like @recoder.');

/** A repository path glob Bun can parse, matched against repo-relative paths. */
const pathGlobSchema = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.refine(isParsableGlob, 'Each ignored path is a glob like docs/** or **/*.md.');

export const autoReviewPatchSchema = z
	.object({
		enabled: z.boolean(),
		intervalSeconds: z.literal(AUTO_REVIEW_INTERVALS),
		onMention: z.boolean(),
		mentionHandle: handleSchema,
		onOpened: z.boolean(),
		onPushed: z.boolean(),
		skipDrafts: z.boolean(),
		postResults: z.boolean(),
		excludedRepoIds: z.array(z.string().max(200)).max(500),
		ignoredPaths: z.array(pathGlobSchema).max(100),
		maxInlineComments: z.number().int().min(0).max(MAX_INLINE_COMMENTS),
		checkThreshold: z.enum([...FINDING_SEVERITIES, 'off'])
	})
	.partial();

function isParsableGlob(glob: string): boolean {
	try {
		new Bun.Glob(glob).match('');

		return true;
	} catch {
		return false;
	}
}

function settingsFile(): string {
	return join(serverDataDir(), 'auto-review.json');
}

/** The saved settings over the defaults. A missing or unreadable file is the defaults: the watcher stays off. */
export function readAutoReviewSettings(): AutoReviewSettings {
	if (sharedSettingsActive()) {
		return { ...DEFAULT_AUTO_REVIEW_SETTINGS, ...autoReviewPatchSchema.parse(readSharedSetting('auto-review') ?? {}) };
	}

	try {
		const parsed = autoReviewPatchSchema.safeParse(JSON.parse(readFileSync(settingsFile(), 'utf8')));

		return parsed.success ? { ...DEFAULT_AUTO_REVIEW_SETTINGS, ...parsed.data } : DEFAULT_AUTO_REVIEW_SETTINGS;
	} catch {
		return DEFAULT_AUTO_REVIEW_SETTINGS;
	}
}

/** Merge a validated patch over the saved settings and write them through a temp file. */
export function saveAutoReviewSettings(patch: z.infer<typeof autoReviewPatchSchema>): AutoReviewSettings {
	const next = { ...readAutoReviewSettings(), ...patch };

	if (sharedSettingsActive()) {
		writeSharedSetting('auto-review', next);

		return next;
	}

	const file = settingsFile();
	const temporary = `${file}.${process.pid}.tmp`;

	writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
	renameSync(temporary, file);

	return next;
}
