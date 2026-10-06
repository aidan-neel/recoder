import type { DiffHunk } from '@recoder/shared';
import type { BehaviorAspect, SymbolRange, SymbolReference } from './types.js';

/**
 * What changed lines must contain for the change to alter each aspect a
 * caller can depend on. A default is `??`, `||` or `or` before a literal, or
 * the word; a bare `||` or arrow is too common in conditions and callbacks.
 */
const ASPECT_PATTERNS: [BehaviorAspect, RegExp][] = [
	['default', /\?\?|\|\|\s*(?:['"`\d[{]|null\b|true\b|false\b)|\bdefault|\bfallback|\bor\s+(?:['"\d[{]|None\b)/i],
	['return value', /\breturn\b|\byield\b/],
	['error', /\bthrow\b|\braise\b|\breject\b|Error\b|Exception\b/],
	['ordering', /sort|revers|order|rank/i],
	['expiry', /ttl|expir|timeout|deadline|max_?age/i],
	['normalization', /trim|lower|upper|normali[sz]|strip|canonical/i],
	['persisted shape', /json|serializ|dumps|pickle|persist|schema|insert|writeFile|storage/i]
];

/** The aspects a caller can depend on through the value a call gives back. */
const RESULT_ASPECTS: BehaviorAspect[] = ['return value', 'ordering', 'expiry', 'normalization', 'persisted shape'];

/** Documented behavior is shown clipped, so a long comment cannot crowd out the callers. */
const DOC_CHARS = 240;

/** A parameter default inside the parentheses of a signature. */
const PARAM_DEFAULT = /\([^)]*[^=!<>]=[^=>][^)]*\)/;

/** The text of the lines a file's hunks add or delete within a head-side declaration's lines. */
function changedText(symbol: SymbolRange, hunks: DiffHunk[]): string[] {
	const texts: string[] = [];

	for (const hunk of hunks) {
		let previousNew = hunk.newStart - 1;

		for (const line of hunk.lines) {
			if (line.newNo !== null) previousNew = line.newNo;

			const at = line.type === 'add' ? line.newNo : line.type === 'del' ? previousNew : null;

			if (at !== null && at >= symbol.startLine - (line.type === 'del' ? 1 : 0) && at <= symbol.endLine)
				texts.push(line.text);
		}
	}

	return texts;
}

/**
 * Which behaviors of a modified declaration its changed lines touch, in a
 * fixed order: a default, the value it returns, an error it raises, ordering,
 * expiry, normalization, or the shape it persists. A changed parameter default
 * in the signature counts as a changed default.
 */
export function changedAspects(
	symbol: SymbolRange & { signature: string; previousSignature?: string },
	hunks: DiffHunk[]
): BehaviorAspect[] {
	const texts = changedText(symbol, hunks);
	const was = symbol.previousSignature;
	const defaults = was !== undefined && was !== symbol.signature && PARAM_DEFAULT.test(`${was}\n${symbol.signature}`);

	return ASPECT_PATTERNS.filter(
		([aspect, pattern]) => (aspect === 'default' && defaults) || texts.some((text) => pattern.test(text))
	).map(([aspect]) => aspect);
}

/** The comment block right above a declaration at the head, without its comment markers; undefined when there is none. */
export function docComment(source: string, startLine: number): string | undefined {
	const lines = source.split('\n');
	const block: string[] = [];

	for (let index = startLine - 2; index >= 0; index--) {
		const line = lines[index].trim();

		if (!/^(\/\*\*?|\*|\/\/|#)/.test(line)) break;

		block.unshift(line.replace(/^(\/\*\*?|\*\/|\*|\/\/+|#+)\s?/, '').replace(/\*\/$/, ''));
	}

	const text = block.join(' ').replace(/\s+/g, ' ').trim();

	if (!text) return undefined;

	return text.length > DOC_CHARS ? `${text.slice(0, DOC_CHARS)}…` : text;
}

/** The argument text of the first call to `name` on the line and what follows it; null when the line has no such call. */
function callParts(text: string, name: string): { before: string; args: string; after: string } | null {
	const match = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\s*\\(`).exec(text);

	if (!match) return null;

	const open = match.index + match[0].length;
	let depth = 1;
	let index = open;

	for (; index < text.length && depth; index++) {
		if (text[index] === '(') depth++;
		if (text[index] === ')') depth--;
	}

	return { before: text.slice(0, match.index), args: text.slice(open, index - 1), after: text.slice(index) };
}

/** Top-level arguments in a call's argument text. */
function argumentCount(args: string): number {
	if (!args.trim()) return 0;

	let depth = 0;
	let count = 1;

	for (const char of args) {
		if ('([{'.includes(char)) depth++;
		if (')]}'.includes(char)) depth--;
		if (char === ',' && depth === 0) count++;
	}

	return count;
}

/** What one call site's line shows it relies on: the value it gets back, a parameter default, or the error. */
function relies(text: string, name: string, params: number): Set<BehaviorAspect> {
	const call = callParts(text, name);
	const found = new Set<BehaviorAspect>();

	if (/\bcatch\b|\bexcept\b|\btry\b|\.catch\(/.test(text)) found.add('error');
	if (!call) return found;

	const lead = call.before.replace(/(?:await\s+)?(?:new\s+)?[\w$.?]*$/, '').trim();
	const taken = /(?:[=(,?:[!&|+\-*/<>%]|\breturn|\byield|\bin|\bof|\bcase)$/.test(lead);
	const consumed = /^\s*(?:\.|\[|\?|[-+*/%<>=!&|]|\bas\b|\bin\b)/.test(call.after);

	if (taken || consumed) for (const aspect of RESULT_ASPECTS) found.add(aspect);

	if (argumentCount(call.args) < params) found.add('default');

	return found;
}

/**
 * For a declaration whose behavior changed, which of those changes each call
 * site depends on, judged from its one source line: a call whose result is
 * assigned, returned, passed on, compared or chained depends on the returned
 * value and what shapes it; a call with fewer arguments than parameters
 * depends on the defaults; a call inside a try or catch depends on the error.
 */
export function dependence(
	name: string,
	params: number,
	aspects: BehaviorAspect[]
): (ref: SymbolReference) => BehaviorAspect[] {
	return (ref) => {
		const found = relies(ref.text, name, params);

		return aspects.filter((aspect) => found.has(aspect));
	};
}
