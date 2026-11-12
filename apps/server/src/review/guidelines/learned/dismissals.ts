import { z } from 'zod';
import { DISMISSAL_REASONS, type DismissalReason } from '@recoder/shared';
import { learnedTable } from './learned-table.js';

/** A finding a person dismissed, remembered so a later review of the same repository does not report it again. */
export interface Dismissal {
	repoId: string;
	/**
	 * What the finding is matched by in later reviews (`dismissalFingerprint`); it holds no line number. Dismissals
	 * recorded before claims split one line hold the place alone, which `matchesDismissal` still reads.
	 */
	fingerprint: string;
	file: string;
	category: string;
	title: string;
	/** Why the person dismissed it; dismissals saved before reasons were chosen have none. */
	reason?: DismissalReason;
	/** What the person added in their own words. */
	note?: string;
	dismissedAt: string;
}

/** The newest dismissals kept for each repository. */
export const MAX_DISMISSALS_PER_REPO = 200;

const REASONS: ReadonlySet<string> = new Set(DISMISSAL_REASONS);

const dismissalSchema = z.object({
	repoId: z.string(),
	fingerprint: z.string(),
	file: z.string(),
	category: z.string(),
	title: z.string(),
	reason: z.enum(DISMISSAL_REASONS).optional(),
	note: z.string().optional(),
	dismissedAt: z.string()
});

/**
 * A dismissal saved before reasons were chosen held the person's free text
 * in `reason`; it is read as the note, with no reason.
 */
function withChosenReason(saved: unknown): unknown {
	if (!saved || typeof saved !== 'object' || !('reason' in saved)) return saved;

	const { reason, ...rest } = saved;

	if (typeof reason !== 'string' || REASONS.has(reason)) return saved;

	return { ...rest, note: reason };
}

const table = learnedTable<Dismissal>({
	setting: 'dismissals',
	file: 'dismissed-findings.json',
	schema: z.record(z.string(), z.array(z.preprocess(withChosenReason, dismissalSchema)))
});

/** A repository's dismissals, newest first. */
export function listDismissals(repoId: string): Dismissal[] {
	return table.read()[repoId] ?? [];
}

/** Remembers a dismissal as the newest of its repository; dismissing the same finding again replaces it. */
export function recordDismissal(dismissal: Dismissal): void {
	const saved = table.read();
	const others = (saved[dismissal.repoId] ?? []).filter((held) => held.fingerprint !== dismissal.fingerprint);

	saved[dismissal.repoId] = [dismissal, ...others].slice(0, MAX_DISMISSALS_PER_REPO);
	table.write(saved);
}

/**
 * Forgets every dismissal whose fingerprint `matches` says belongs to the
 * finding being restored, so a key in the old place-only form is removed as
 * well as one in the current form; false when none was held.
 */
export function removeDismissal(repoId: string, matches: (fingerprint: string) => boolean): boolean {
	const saved = table.read();
	const held = saved[repoId] ?? [];
	const kept = held.filter((dismissal) => !matches(dismissal.fingerprint));

	if (kept.length === held.length) return false;

	saved[repoId] = kept;
	table.write(saved);

	return true;
}
