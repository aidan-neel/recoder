import type { DetectorResult } from '../detectors/types.js';
import { testBlocks } from '../detectors/test-source.js';
import { symbolsOf } from '../change-model/symbols.js';
import { EDITS_BY_SHAPE, mutantsAt, swapErrorClass, type Edit, type Mutant } from './mutants.js';

/** What a suspicion says about the weak assertion, which picks the mutation. */
type Shape = 'broadError' | 'lowerBound' | 'someForEvery' | 'presence' | 'output' | 'selection' | 'generic';

/** Mutants tried per suspicion, at most. */
const MAX_AIMED = 3;

const ERROR_CLASS = /\b[A-Z]\w*(?:Error|Exception)\b/g;

/** The shape of a detector's suspicion, from the words of its title and body. */
function shapeOf(result: DetectorResult): Shape {
	const text = `${result.title} ${result.body}`;

	if (/printed/i.test(text)) return 'output';
	if (/not which one/i.test(text)) return 'selection';
	if (/accepts any|broader error|never checks which error|error type/i.test(text)) return 'broadError';
	if (/only from below|exact value/i.test(text)) return 'lowerBound';
	if (/only some|some items/i.test(text)) return 'someForEvery';
	if (/presence|truthy/i.test(text)) return 'presence';

	return 'generic';
}

/**
 * Names the weak test mentions: error classes, called functions and the words
 * of its assertions. Source lines that hold them are the ones the test is about.
 */
function termsOf(head: string, line: number): string[] {
	const block = [...testBlocks(head).values()].find((test) => test.startLine <= line && line <= test.endLine);

	if (!block) return [];

	const words = block.body.match(/\b[A-Za-z_$][\w$]{3,}\b/g) ?? [];
	const ignored = new Set(['test', 'expect', 'async', 'await', 'const', 'true', 'false', 'null', 'return', 'function']);

	return [...new Set(words.filter((word) => !ignored.has(word)))];
}

/** Error classes the test names, in order. */
function errorClasses(head: string, line: number): string[] {
	const block = [...testBlocks(head).values()].find((test) => test.startLine <= line && line <= test.endLine);

	return [...new Set(block?.body.match(ERROR_CLASS) ?? [])];
}

/** Source lines holding a term, most terms first, so the mutants land where the test looks. */
function linesByTerms(text: string, terms: readonly string[]): number[] {
	return text
		.split('\n')
		.map((content, index) => ({ line: index + 1, hits: terms.filter((term) => content.includes(term)).length }))
		.filter((entry) => entry.hits > 0)
		.sort((a, b) => b.hits - a.hits || a.line - b.line)
		.map((entry) => entry.line);
}

/** The lines that make a new instance of a class that extends `broad` in the sources, else the lines that throw a new error. */
function specificLines(text: string, specifics: ReadonlySet<string>): number[] {
	const lines = text.split('\n');

	const made = lines.flatMap((content, index) => {
		const name = /\bnew\s+([A-Z]\w*)\(/.exec(content)?.[1];

		return name && specifics.has(name) ? [index + 1] : [];
	});

	return made.length
		? made
		: lines.flatMap((content, index) => (/\bthrow\s+new\s+[A-Z]\w*\(/.test(content) ? [index + 1] : []));
}

/** Classes the sources declare as `extends broad`. */
function subclassesOf(broad: string, sources: readonly { head: string }[]): Set<string> {
	const pattern = new RegExp(`\\bclass\\s+([A-Z]\\w*)\\s+extends\\s+${broad}\\b`, 'g');

	return new Set(sources.flatMap((source) => [...source.head.matchAll(pattern)].map((match) => match[1]!)));
}

/** Names the test calls: `run(`, `.get(`, `new Thing(`. */
function calledNames(head: string, line: number): Set<string> {
	const block = [...testBlocks(head).values()].find((test) => test.startLine <= line && line <= test.endLine);

	return new Set([...(block?.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g) ?? [])].map((match) => match[1]!));
}

/** Lines inside the functions the test calls, which a change there can reach. */
async function calledLines(source: { path: string; head: string }, names: ReadonlySet<string>): Promise<number[]> {
	const symbols = (await symbolsOf(source.path, source.head)) ?? [];
	const lines: number[] = [];

	for (const symbol of symbols) {
		if (!['function', 'method'].includes(symbol.kind) || !names.has(symbol.name)) continue;

		for (let line = symbol.startLine; line <= symbol.endLine; line++) lines.push(line);
	}

	return lines;
}

/**
 * Up to `MAX_AIMED` mutants for one suspicion: the operator its shape names.
 * Lines inside the functions the test calls come first, then the lines that
 * hold the names the weak test uses.
 */
export async function aimedMutants(
	suspicion: DetectorResult,
	testHead: string,
	sources: readonly { path: string; head: string }[]
): Promise<Mutant[]> {
	const shape = shapeOf(suspicion);
	const terms = termsOf(testHead, suspicion.line);
	const broad = errorClasses(testHead, suspicion.line)[0] ?? 'Error';
	const specifics = subclassesOf(broad, sources);
	const called = calledNames(testHead, suspicion.line);

	const edits: readonly Edit[] = shape === 'broadError' ? [swapErrorClass(broad)] : EDITS_BY_SHAPE[shape];
	const found: Mutant[] = [];

	for (const source of sources) {
		const inside = shape === 'broadError' ? [] : await calledLines(source, called);
		const lines = shape === 'broadError' ? specificLines(source.head, specifics) : linesByTerms(source.head, terms);
		const ranked = [...inside, ...lines];

		found.push(...mutantsAt(source.path, source.head, [...new Set(ranked)], edits));
	}

	return found.slice(0, MAX_AIMED);
}
