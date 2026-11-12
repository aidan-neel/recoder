import type { RuleApplicabilityDecision } from '@recoder/shared';
import { matchesGlob } from '../../chat/directive.js';
import type { ReviewInventory } from '../../pipeline/inventory.js';
import { nestedScopeOf } from './glob.js';
import { findLedgerRule, ruleCitation, type RepoRule, type RuleLedger } from './types.js';

/** Location and cited rule id checked for repository-rule applicability. */
export interface RuleCheckTarget {
	file: string;
	line?: number;
	endLine?: number;
	side?: 'old' | 'new';
	ruleId?: string;
}

function spanTouchesChange(inventory: ReviewInventory, target: RuleCheckTarget): boolean {
	if (target.line === undefined) return true;

	const diffFile = inventory.diffs.find((entry) => entry.path === target.file);

	if (!diffFile || !diffFile.hunks.length) return true;

	const start = target.line;
	const end = target.endLine && target.endLine >= start ? target.endLine : start;
	const side = target.side ?? 'new';

	return diffFile.hunks.some((hunk) =>
		hunk.lines.some((entry) =>
			side === 'old'
				? entry.type === 'del' && typeof entry.oldNo === 'number' && entry.oldNo >= start && entry.oldNo <= end
				: entry.type === 'add' && typeof entry.newNo === 'number' && entry.newNo >= start && entry.newNo <= end
		)
	);
}

function lineSpanLabel(start: number, end: number): string {
	return start === end ? `Line ${start}` : `Lines ${start}-${end}`;
}

/**
 * Evaluates whether a repository rule governs `target` before any violation is
 * checked: ledger membership, inventory membership, source-file precedence,
 * nested folder scope, `appliesTo` glob, and whether the flagged span modifies lines.
 */
export function evaluateRuleApplicability(
	rule: RepoRule | undefined,
	target: RuleCheckTarget,
	ledger: RuleLedger | null,
	inventory?: ReviewInventory,
	evidenceIds: string[] = []
): RuleApplicabilityDecision {
	const cited = [...evidenceIds];

	if (!rule) {
		return {
			outcome: 'not-applicable',
			reason: `Rule ${target.ruleId ?? '(none)'} is not in the repository rule ledger.`,
			evidenceIds: cited
		};
	}

	if (inventory) {
		const invFile = inventory.files.find((entry) => entry.path === target.file);

		if (!invFile) {
			return {
				outcome: 'not-applicable',
				reason: `${target.file} is not in the change inventory.`,
				evidenceIds: cited
			};
		}

		if (invFile.excludeReason) {
			return {
				outcome: 'not-applicable',
				reason: `${target.file} is excluded from review (${invFile.excludeReason}).`,
				evidenceIds: cited
			};
		}
	}

	if (rule.excludedScopes?.some((scope) => matchesGlob(target.file, scope))) {
		const winner = findLedgerRule(ledger, rule.overriddenBy);

		return {
			outcome: 'not-applicable',
			reason: winner
				? `Rule ${rule.id} (${ruleCitation(rule)}) is overridden for ${target.file} by ${winner.id} (${ruleCitation(winner)}).`
				: `Rule ${rule.id} (${ruleCitation(rule)}) is overridden for ${target.file} by a higher-precedence guideline file.`,
			evidenceIds: cited
		};
	}

	const nestedScope = nestedScopeOf(rule.source.path);

	if (nestedScope && !matchesGlob(target.file, nestedScope)) {
		return {
			outcome: 'not-applicable',
			reason: `Rule ${rule.id} (${ruleCitation(rule)}) applies only to ${nestedScope}, not ${target.file}.`,
			evidenceIds: cited
		};
	}

	if (rule.appliesTo && !matchesGlob(target.file, rule.appliesTo)) {
		return {
			outcome: 'not-applicable',
			reason: `Rule ${rule.id} (${ruleCitation(rule)}) applies to ${rule.appliesTo}, not ${target.file}.`,
			evidenceIds: cited
		};
	}

	if (inventory && target.line !== undefined && !spanTouchesChange(inventory, target)) {
		const end = target.endLine && target.endLine >= target.line ? target.endLine : target.line;

		return {
			outcome: 'not-applicable',
			reason: `${lineSpanLabel(target.line, end)} of ${target.file} was not modified by this change.`,
			evidenceIds: cited
		};
	}

	const scope = rule.appliesTo ?? nestedScope ?? 'all files';

	return {
		outcome: 'applies',
		reason: `Rule ${rule.id} (${ruleCitation(rule)}) covers ${scope} and applies to the changed lines in ${target.file}.`,
		evidenceIds: cited
	};
}
