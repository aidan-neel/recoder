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

/** One atomic rule from the repo's guidelines, with a stable id lenses and findings cite. */
export interface RepoRule {
	/** `R1`, `R2`… in source order. */
	id: string;
	/** The rule, restated as one imperative sentence. */
	text: string;
	source: { path: string; line?: number };
	/** Glob of files the rule applies to; every file when unset. */
	appliesTo?: string;
	/** Set when the rule is mechanical; such rules run as a detector instead of in the rules lens. */
	check?: MechanicalCheck;
}

/**
 * The repo's guidelines as numbered rules, read at the base commit and cached
 * by the hash of the files they came from, so every run reads the same ledger.
 */
export interface RuleLedger {
	rules: RepoRule[];
	sourcesHash: string;
}
