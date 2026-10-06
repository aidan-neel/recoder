/** What kind of declaration a symbol is, as far as the parser can tell. */
export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'variable' | 'component' | 'module';

/** A declaration's place in a file at the PR head (or at the merge base for deleted code). */
export interface SymbolRange {
	/** `createRun`. */
	name: string;
	/** `ReviewRun.createRun` for a method, the bare name otherwise. */
	qualifiedName: string;
	kind: SymbolKind;
	file: string;
	/** 1-based, inclusive. */
	startLine: number;
	endLine: number;
}

/** How a reference uses the name, from the language's syntax: `test` is any use but an import inside a test file. */
export type ReferenceKind = 'call' | 'import' | 'type' | 'test' | 'other';

/** A place outside the symbol that names it: a caller, an import, a re-export. */
export interface SymbolReference {
	file: string;
	line: number;
	/** The matching line, trimmed and clipped. */
	text: string;
	kind?: ReferenceKind;
	/** The line is one this diff adds, so it may already match the new contract. */
	inDiff?: true;
	/** The changed behaviors this call relies on; set only with caller selection on. */
	dependsOn?: BehaviorAspect[];
}

/** A behavior of a declaration that a caller can rely on and a change can alter. */
export type BehaviorAspect =
	'default' | 'return value' | 'error' | 'ordering' | 'expiry' | 'normalization' | 'persisted shape';

/** Shape measures used by the complexity detector and the readability lens. */
export interface SymbolMetrics {
	/** Lines from the declaration to its closing line. */
	lines: number;
	/** Deepest nesting of blocks inside the body. */
	maxDepth: number;
	params: number;
}

/**
 * A declaration the diff touches, with the context a lens needs to review it
 * without exploring: who calls it, what it calls, its tests, and comparable
 * declarations elsewhere in the repo. Built without a model, so the same diff
 * always gives the same change model.
 */
export interface ChangedSymbol extends SymbolRange {
	/** `${file}#${qualifiedName}`; unique within one change model. */
	id: string;
	change: 'added' | 'modified' | 'deleted';
	/** Inventory hunk ids that fall inside the symbol. */
	hunkIds: string[];
	/** Parser language id (`typescript`, `python`…). */
	language: string;
	/** The declaration's first line or lines, up to the body. */
	signature: string;
	exported: boolean;
	/** Names called inside the body, de-duplicated, in source order. */
	calls: string[];
	/** Places outside the symbol that name it at the head, sorted by file then line, capped. */
	references: SymbolReference[];
	/** The merge-base signature, set when the signature or export status of this modified declaration changed. */
	previousSignature?: string;
	/** Call sites and tests that use the declaration, outside the diff first; scripts only count files that import it. */
	callers?: SymbolReference[];
	/** Callers past the cap, in the same order and capped themselves; set only when the cap cut some. */
	omittedCallers?: SymbolReference[];
	/** Behaviors of a modified declaration its changed lines alter; set only with caller selection on. */
	behavior?: BehaviorAspect[];
	/** The comment above the declaration at the head, shown as its documented behavior when `behavior` is set. */
	doc?: string;
	/** Set when the checkout was not fully searched for the name, so empty `references` does not mean unused. */
	usageUnknown?: true;
	/** Test files likely to cover it: path convention first, then files that name it. */
	tests: string[];
	/** Up to three comparable existing declarations (same kind, same folder or sibling files), sorted deterministically. */
	examples: SymbolRange[];
	metrics: SymbolMetrics;
}

/** The repo's own distribution of symbol shape for one language, from a deterministic sample. */
export interface RepoMetricsBaseline {
	language: string;
	sampled: number;
	p95: SymbolMetrics;
}

/** Every changed symbol in the review, in file then line order. */
export interface ChangeModel {
	symbols: ChangedSymbol[];
	/** Inventory hunk id → ids of the symbols it touches. A hunk outside any symbol maps to []. */
	byHunk: Record<string, string[]>;
	baselines: RepoMetricsBaseline[];
	/** Changed files the parser has no grammar for; lenses fall back to the raw patch for them. */
	unparsed: string[];
}
