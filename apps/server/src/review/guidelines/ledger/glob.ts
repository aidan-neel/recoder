import { matchesGlob, normalizeGlob } from '../../chat/directive.js';
import { NESTED_NAMES } from './sources.js';
import type { RepoRule } from './types.js';

/** Folder prefix (`apps/web`) when `sourcePath` is a nested `AGENTS.md` or `CLAUDE.md`, else undefined. */
export function nestedFolderOf(sourcePath: string): string | undefined {
	const slash = sourcePath.lastIndexOf('/');

	if (slash <= 0) return undefined;

	const name = sourcePath.slice(slash + 1);

	return NESTED_NAMES.has(name) ? sourcePath.slice(0, slash) : undefined;
}

/** Glob covering a nested instruction file's subtree (`apps/web/**`), or undefined for repo-wide sources. */
export function nestedScopeOf(sourcePath: string): string | undefined {
	const folder = nestedFolderOf(sourcePath);

	return folder ? `${folder}/**` : undefined;
}

/** Effective file glob a rule governs after combining any nested folder boundary with `appliesTo`; undefined means all files. */
export function effectiveRuleScope(rule: Pick<RepoRule, 'source' | 'appliesTo'>): string | undefined {
	const folder = nestedFolderOf(rule.source.path);

	if (!folder) return rule.appliesTo;
	if (!rule.appliesTo || rule.appliesTo === `${folder}/**`) return `${folder}/**`;
	if (rule.appliesTo.startsWith(`${folder}/`)) return rule.appliesTo;
	if (rule.appliesTo.startsWith('**/')) return `${folder}/${rule.appliesTo}`;

	return `${folder}/**`;
}

/** Whether the rule applies to the file: inside its nested folder (when any), not overridden there, and matching `appliesTo`. */
export function ruleAppliesTo(rule: RepoRule, path: string): boolean {
	const nestedScope = nestedScopeOf(rule.source.path);

	if (nestedScope && !matchesGlob(path, nestedScope)) return false;
	if (rule.excludedScopes?.some((scope) => matchesGlob(path, scope))) return false;

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
