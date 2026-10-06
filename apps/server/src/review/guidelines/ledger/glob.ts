import { matchesGlob, normalizeGlob } from '../../chat/directive.js';
import type { RepoRule } from './types.js';

/** Whether the rule applies to the file: it names no files, or its glob matches the path. */
export function ruleAppliesTo(rule: RepoRule, path: string): boolean {
	return !rule.appliesTo || matchesGlob(path, rule.appliesTo);
}

/**
 * A model-written glob in the form the detectors match with (`*.ts` → `**\/*.ts`),
 * or undefined when it covers every file or Bun can't parse it.
 */
export function cleanGlob(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;

	const glob = normalizeGlob(raw);

	if (!glob || glob.length > 200) return undefined;

	try {
		new Bun.Glob(glob).match('');

		return glob;
	} catch {
		return undefined;
	}
}
