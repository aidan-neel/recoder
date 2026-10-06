import { git } from '../../../evidence/git.js';
import { MAX_OMITTED, pickCallers, type ResolvedReference } from './callers.js';
import { dependence } from './dependence.js';
import { importsModule, isScriptLanguage } from './imports.js';
import { languageFor } from './languages.js';
import { fileReferences, inTestFile, lineKind, type FileReferences } from './reference-kinds.js';
import { byCodePoint, mapLimit, readTracked } from './repo.js';
import { isTestPath, testStem } from './test-files.js';
import type { BehaviorAspect, ReferenceKind, SymbolRange, SymbolReference } from './types.js';

/** Symbols whose references are searched; the rest keep an empty list, so cost stays bounded. */
const MAX_SEARCHED = 60;
const MAX_REFERENCES = 8;
const MAX_TESTS = 5;
/** Matches kept per file and in all, so a common name can't flood the model. */
const MATCHES_PER_FILE = 4;
const MAX_MATCH_LINES = 400;
const TEXT_CHARS = 120;
const MIN_NAME_CHARS = 3;
/** Files parsed to classify one symbol's hits, and in all; hits in the rest keep a line-based guess. */
const CLASSIFIED_FILES_PER_SYMBOL = 20;
const MAX_CLASSIFIED_FILES = 150;

/** Most relevant first when the cap cuts: calls, then tests, types, imports and the rest. */
const KIND_RANK: Record<ReferenceKind, number> = { call: 0, test: 1, type: 2, import: 3, other: 4 };

/** Path segments that only say "source" or "tests", dropped so `src/a/b.ts` lines up with `tests/a/b.test.ts`. */
const LAYOUT_SEGMENTS = new Set(['src', 'lib', 'main', 'test', 'tests', '__tests__', 'spec', 'specs']);

/** Where a name appears at the head, and which files name it. */
interface NameHits {
	matches: SymbolReference[];
	files: string[];
	/** The search failed or hit the line cap, so a file that names it may be missing. */
	partial: boolean;
}

/** What a symbol is referenced by and tested in. */
export interface SymbolUsage {
	references: SymbolReference[];
	tests: string[];
	/** Calls and tests that use it, outside the diff first; empty when none was found. */
	callers: SymbolReference[];
	/** The next callers, references and tests in the same order, cut by their caps. */
	omittedCallers: SymbolReference[];
	omittedReferences: SymbolReference[];
	omittedTests: string[];
	/** Whether the whole checkout was searched for the name; an empty list means unused only then. */
	searched: boolean;
}

/** A symbol as references and tests need it: where it is, and whether it still exists at the head. */
type Searched = SymbolRange & {
	language: string;
	exported: boolean;
	deleted: boolean;
	/** With caller selection on: the behaviors the change alters, and the parameter count a call is checked against. */
	behavior?: BehaviorAspect[];
	metrics?: { params: number };
};

/** Every line at the checkout that names `name` as a whole word, sorted and capped. */
async function grepName(root: string, name: string, signal: AbortSignal): Promise<NameHits> {
	const out = await git(
		root,
		[
			'-c',
			'core.quotePath=false',
			'grep',
			'-z',
			'-n',
			'-w',
			'-I',
			'-F',
			`--max-count=${MATCHES_PER_FILE}`,
			'-e',
			name,
			'--',
			'.'
		],
		signal
	);

	if (out.code > 1) return { matches: [], files: [], partial: true };
	if (out.code !== 0) return { matches: [], files: [], partial: false };

	const matches: SymbolReference[] = [];

	const rows = out.stdout.split('\n');

	for (const row of rows.slice(0, MAX_MATCH_LINES)) {
		const [file, line, ...rest] = row.split('\0');

		if (!file || !line) continue;

		matches.push({ file, line: Number(line), text: rest.join(' ').trim().slice(0, TEXT_CHARS) });
	}

	matches.sort((a, b) => byCodePoint(a.file, b.file) || a.line - b.line);

	return { matches, files: [...new Set(matches.map((match) => match.file))], partial: rows.length > MAX_MATCH_LINES };
}

/** The folder and stem with layout segments dropped: `forge/gh` for both `src/forge/gh.ts` and `tests/forge/gh.test.ts`. */
function layoutKey(path: string): string {
	const folders = path.split('/').slice(0, -1);

	return [...folders.filter((segment) => !LAYOUT_SEGMENTS.has(segment)), testStem(path)].join('/');
}

/** Test files that follow a path convention for `file`: same folder layout and stem, else the same stem anywhere. */
function conventionTests(file: string, testFiles: string[]): string[] {
	const key = layoutKey(file);
	const mirrored = testFiles.filter((test) => test !== file && layoutKey(test) === key);

	if (mirrored.length) return mirrored;

	const stem = testStem(file);

	return stem.length >= 4 ? testFiles.filter((test) => test !== file && testStem(test) === stem) : [];
}

/** Which symbols get a search: exported ones first, then in file and line order, skipping very short names. */
function searchOrder(symbols: Searched[]): number[] {
	return symbols
		.map((symbol, index) => ({ symbol, index }))
		.filter(({ symbol }) => symbol.name.length >= MIN_NAME_CHARS)
		.sort(
			(a, b) =>
				Number(b.symbol.exported) - Number(a.symbol.exported) ||
				byCodePoint(a.symbol.file, b.symbol.file) ||
				a.symbol.startLine - b.symbol.startLine
		)
		.slice(0, MAX_SEARCHED)
		.map(({ index }) => index);
}

/** True for a match within the symbol's own lines at the head; a deleted symbol has no lines there. */
function inside(symbol: Searched, match: SymbolReference): boolean {
	return (
		!symbol.deleted && match.file === symbol.file && match.line >= symbol.startLine && match.line <= symbol.endLine
	);
}

/** The files whose hits get parsed: those with a grammar, each symbol's other files first, a few per symbol, then capped in all. */
function filesToClassify(symbols: Searched[], outside: SymbolReference[][]): string[] {
	const files = new Set<string>();

	symbols.forEach((symbol, index) => {
		const parsable = outside[index].filter((match) => languageFor(match.file));
		const others = parsable.filter((match) => match.file !== symbol.file).map((match) => match.file);
		const own = parsable.filter((match) => match.file === symbol.file).map((match) => match.file);

		for (const file of [...new Set([...others, ...own])].slice(0, CLASSIFIED_FILES_PER_SYMBOL)) files.add(file);
	});

	return [...files].slice(0, MAX_CLASSIFIED_FILES);
}

/** Parses each file once for the names that hit in it; null for a file the parser can't read. */
async function classifyFiles(
	root: string,
	files: string[],
	namesByFile: Map<string, Set<string>>,
	tracked: Set<string>,
	signal: AbortSignal
): Promise<Map<string, FileReferences | null>> {
	const parsed = await mapLimit(files, 8, async (file) => {
		if (signal.aborted) return null;

		const source = await readTracked(root, file, tracked);

		return source === null ? null : fileReferences(file, source, namesByFile.get(file) ?? new Set());
	});

	return new Map(files.map((file, index) => [file, parsed[index]]));
}

/** Names that hit in each file, from every symbol's search. */
function namesPerFile(hits: Map<string, NameHits>): Map<string, Set<string>> {
	const byFile = new Map<string, Set<string>>();

	for (const [name, found] of hits) {
		for (const file of found.files) byFile.set(file, (byFile.get(file) ?? new Set()).add(name));
	}

	return byFile;
}

/** One hit's kind and whether its file imports the symbol's module; null when the hit isn't a reference. */
function resolveHit(
	symbol: Searched,
	match: SymbolReference,
	facts: FileReferences | null | undefined,
	added: Map<string, Set<number>>
): ResolvedReference | null {
	const parsed = facts?.kinds.get(`${symbol.name}\0${match.line}`);

	const kind = parsed
		? inTestFile(match.file, parsed)
		: facts?.exact
			? null
			: lineKind(match.file, match.text, symbol.name);

	if (!kind) return null;

	const script = isScriptLanguage(symbol.language) && isScriptLanguage(languageFor(match.file) ?? '');

	const imports =
		match.file === symbol.file
			? true
			: script && facts
				? importsModule(match.file, facts.specifiers, symbol.file)
				: undefined;

	const inDiff = added.get(match.file)?.has(match.line);

	return { ref: { ...match, kind, ...(inDiff ? { inDiff: true as const } : {}) }, imports };
}

/** Other files that import the module first, then ones that might, then ones that don't, then the symbol's own file. */
function tier(symbol: Searched, hit: ResolvedReference): number {
	if (hit.ref.file === symbol.file) return 3;

	return hit.imports === true ? 0 : hit.imports === undefined ? 1 : 2;
}

function byRelevance(symbol: Searched): (a: ResolvedReference, b: ResolvedReference) => number {
	return (a, b) =>
		tier(symbol, a) - tier(symbol, b) ||
		KIND_RANK[a.ref.kind ?? 'other'] - KIND_RANK[b.ref.kind ?? 'other'] ||
		byCodePoint(a.ref.file, b.ref.file) ||
		a.ref.line - b.ref.line;
}

/**
 * Whether dropping non-references could have hidden a real one: a file whose
 * matches hit the per-file cap and lost some may hold a use past the cap.
 */
function hidesUse(found: NameHits, dropped: SymbolReference[]): boolean {
	const perFile = new Map<string, number>();

	for (const match of found.matches) perFile.set(match.file, (perFile.get(match.file) ?? 0) + 1);

	return dropped.some((match) => (perFile.get(match.file) ?? 0) >= MATCHES_PER_FILE);
}

/** Everything the search knows about one symbol's hits. */
interface Context {
	facts: Map<string, FileReferences | null>;
	added: Map<string, Set<number>>;
	testFiles: string[];
}

/** One symbol's usage from its hits outside its own lines; `found` is undefined when it wasn't searched. */
function usageOf(symbol: Searched, found: NameHits | undefined, outside: SymbolReference[], ctx: Context): SymbolUsage {
	const dropped: SymbolReference[] = [];
	const resolved: ResolvedReference[] = [];

	for (const match of outside) {
		const hit = resolveHit(symbol, match, ctx.facts.get(match.file), ctx.added);

		if (hit) resolved.push(hit);
		else dropped.push(match);
	}

	const named = [...new Set(resolved.map(({ ref }) => ref.file))].filter(
		(file) => isTestPath(file) && file !== symbol.file
	);

	const tests = [...new Set([...conventionTests(symbol.file, ctx.testFiles), ...named])];
	const depends = symbol.behavior ? dependence(symbol.name, symbol.metrics?.params ?? 0, symbol.behavior) : undefined;
	const picked = pickCallers(symbol.language, symbol.file, resolved, depends);

	const references = [...resolved].sort(byRelevance(symbol)).map(({ ref }) => ref);

	return {
		references: references.slice(0, MAX_REFERENCES),
		omittedReferences: references.slice(MAX_REFERENCES, MAX_REFERENCES + MAX_OMITTED),
		callers: picked.callers,
		omittedCallers: picked.omitted,
		tests: tests.slice(0, MAX_TESTS),
		omittedTests: tests.slice(MAX_TESTS, MAX_TESTS + MAX_OMITTED),
		searched: found !== undefined && !found.partial && !hidesUse(found, dropped)
	};
}

/**
 * Callers and tests for each symbol, in the same order as `symbols`. Hits in
 * comments, strings and other symbols' declarations are dropped; the rest carry
 * their syntactic kind and are ordered by whether their file imports the
 * symbol's module, then calls first. Tests are convention matches first, then
 * test files that name it. `added` holds the lines the diff adds, by file.
 */
export async function findUsage(
	root: string,
	symbols: Searched[],
	tracked: string[],
	added: Map<string, Set<number>>,
	signal: AbortSignal
): Promise<SymbolUsage[]> {
	const searched = new Set(searchOrder(symbols));

	const names = [...new Set(symbols.filter((_, index) => searched.has(index)).map((symbol) => symbol.name))].sort(
		byCodePoint
	);

	const hits = await mapLimit(names, 6, (name) => grepName(root, name, signal));
	const byName = new Map(names.map((name, index) => [name, hits[index]]));

	const outside = symbols.map((symbol, index) =>
		searched.has(index) ? (byName.get(symbol.name)?.matches ?? []).filter((match) => !inside(symbol, match)) : []
	);

	const facts = await classifyFiles(
		root,
		filesToClassify(symbols, outside),
		namesPerFile(byName),
		new Set(tracked),
		signal
	);

	const ctx: Context = { facts, added, testFiles: tracked.filter(isTestPath) };

	return symbols.map((symbol, index) =>
		usageOf(symbol, searched.has(index) ? byName.get(symbol.name) : undefined, outside[index], ctx)
	);
}
