import type { FindingRule, RuleLevel } from '@recoder/shared';

/**
 * A rule simple enough to check without a model. The set is closed: the
 * ledger only emits these kinds, and the rules detector only runs these.
 */
export type MechanicalCheck =
	/** Files matching `glob` (all files when unset) stay at or under `max` lines. */
	| { kind: 'max-file-lines'; max: number; glob?: string }
	/** Added lines in files matching `glob` must not match `pattern` (a plain JS regex, at most 200 characters). */
	| { kind: 'forbid-pattern'; pattern: string; glob?: string }
	/** Added files matching `files` must also match `mustMatch` (e.g. tests live under `tests/`). */
	| { kind: 'path-pattern'; files: string; mustMatch: string }
	/**
	 * In files matching `glob` (all files when unset), every added `if`, `else`,
	 * `for`, `while` and `do` body is a `{ }` block. Read from the syntax tree,
	 * so arrow functions and other expressions never match.
	 */
	| { kind: 'require-braces'; glob?: string };

/** Where in a guideline source file a rule is written, pinned to its base revision when read from git. */
interface RuleSource {
	path: string;
	line?: number;
	endLine?: number;
	revision?: string;
}

/** One atomic rule from the repo's guidelines, with a stable id lenses and findings cite. */
export interface RepoRule {
	/** `R1`, `R2`… in source order. */
	id: string;
	/** The rule's text word for word as written in the source file, or empty when `verbatim` is `false`. */
	text: string;
	/** False when the model's quote was not verified in the source file; `restatement` holds the wording instead. */
	verbatim?: boolean;
	/** Short one-sentence imperative restatement of the rule. */
	restatement?: string;
	source: RuleSource;
	/** Whether the rule states a hard requirement (`mandatory`) or guidance (`advisory`). */
	level?: RuleLevel;
	/** Glob of files the rule applies to; every file when unset. */
	appliesTo?: string;
	/** Exceptions written next to or inside the rule in its source file. */
	exceptions?: string[];
	/** Sub-scopes where a higher-precedence rule file overrides this rule. */
	excludedScopes?: string[];
	/** Id of the higher-precedence rule that carved out `excludedScopes`, when set. */
	overriddenBy?: string;
	/** Set when the rule is mechanical; such rules run as a detector instead of in the rules lens. */
	check?: MechanicalCheck;
	/**
	 * How the repository's people treat findings of this rule, set for the run
	 * from their votes (`rankRules`) and never cached; absent while their votes
	 * say nothing either way.
	 */
	standing?: 'acted-on' | 'often-dismissed';
}

/**
 * The repo's guidelines as numbered rules, read at the base commit and cached
 * by the hash of the files they came from, so every run reads the same ledger.
 */
export interface RuleLedger {
	rules: RepoRule[];
	sourcesHash: string;
}

/** One-line summary of a rule: its short restatement when present, else its verbatim text on one line. */
export function ruleSummary(rule: Pick<RepoRule, 'text' | 'restatement'>): string {
	return (rule.restatement || rule.text).replace(/\s+/g, ' ').trim();
}

/** A rule's own words: its quote, or its summary when no quote was found in the source file. */
export function ruleWording(rule: Pick<RepoRule, 'text' | 'restatement'>): string {
	return rule.text || ruleSummary(rule);
}

/** Where a rule is stated (`AGENTS.md:41` or `AGENTS.md:41-44`), or just the path when no line is cited. */
export function ruleCitation(rule: Pick<RepoRule, 'source'>): string {
	const { path, line, endLine } = rule.source;

	if (!line) return path;

	return endLine && endLine > line ? `${path}:${line}-${endLine}` : `${path}:${line}`;
}

/** Looks up a rule by ledger id (`R1`), returning undefined when absent. */
export function findLedgerRule(
	ledger: RuleLedger | null | undefined,
	ruleId: string | null | undefined
): RepoRule | undefined {
	return ruleId ? ledger?.rules.find((entry) => entry.id === ruleId) : undefined;
}

/** Projects a ledger rule onto the shared `FindingRule` record carried by findings that cite `ruleId`. */
export function toFindingRule(rule: RepoRule): FindingRule {
	const hasVerbatimQuote = rule.verbatim !== false && Boolean(rule.text);

	return {
		id: rule.id,
		text: hasVerbatimQuote ? rule.text : '',
		...(!hasVerbatimQuote ? { verbatim: false } : {}),
		...(rule.restatement ? { restatement: rule.restatement } : {}),
		...(rule.level ? { level: rule.level } : {}),
		...(rule.appliesTo ? { appliesTo: rule.appliesTo } : {}),
		...(rule.exceptions?.length ? { exceptions: [...rule.exceptions] } : {}),
		source: {
			path: rule.source.path,
			...(rule.source.line !== undefined ? { line: rule.source.line } : {}),
			...(rule.source.endLine !== undefined ? { endLine: rule.source.endLine } : {}),
			...(rule.source.revision ? { revision: rule.source.revision } : {})
		}
	};
}
