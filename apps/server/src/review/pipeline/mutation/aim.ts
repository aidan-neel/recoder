import type { DetectorResult } from '../detectors/types.js';
import { testBlocks } from '../detectors/test-source.js';
import { EDITS_BY_SHAPE, mutantsAt, swapErrorClass, type Edit, type Mutant } from './mutants.js';

/** What a suspicion says about the weak assertion, which picks the mutation. */
export type Shape = 'broadError' | 'lowerBound' | 'someForEvery' | 'presence' | 'generic';

/** Mutants tried per suspicion, at most. */
export const MAX_AIMED = 3;

const ERROR_CLASS = /\b[A-Z]\w*(?:Error|Exception)\b/g;

/** The shape of a detector's suspicion, from the words of its title and body. */
export function shapeOf(result: DetectorResult): Shape {
	const text = `${result.title} ${result.body}`;

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
export function termsOf(head: string, line: number): string[] {
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

/** The lines that throw a new error, which a loose error assertion cannot tell apart. */
function throwLines(text: string): number[] {
	return text.split('\n').flatMap((content, index) => (/\bthrow\s+new\s+[A-Z]\w*\(/.test(content) ? [index + 1] : []));
}

/**
 * Up to `MAX_AIMED` mutants for one suspicion: the operator its shape names,
 * on the lines of the changed sources that hold the names the weak test uses.
 */
export function aimedMutants(
	suspicion: DetectorResult,
	testHead: string,
	sources: readonly { path: string; head: string }[]
): Mutant[] {
	const shape = shapeOf(suspicion);
	const terms = termsOf(testHead, suspicion.line);
	const broad = errorClasses(testHead, suspicion.line)[0];

	const edits: readonly Edit[] =
		shape === 'broadError'
			? [swapErrorClass(broad ?? 'Error')]
			: shape === 'generic'
				? EDITS_BY_SHAPE.generic
				: EDITS_BY_SHAPE[shape];

	return sources
		.flatMap((source) =>
			mutantsAt(
				source.path,
				source.head,
				shape === 'broadError' ? throwLines(source.head) : linesByTerms(source.head, terms),
				edits
			)
		)
		.slice(0, MAX_AIMED);
}
