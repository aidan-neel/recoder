import type { ContextItem, ContextOmission, OmissionReason } from '@recoder/shared';
import type { ChangedSymbol, SymbolReference } from './types.js';

/** What one symbol's prompt block showed, as `describe` decided it. */
interface Shown {
	/** The block states the contract and lists call sites. */
	changed: boolean;
	/** False when the call sites were dropped to fit the block in. */
	withCallers: boolean;
	shown: SymbolReference[];
	/** References listed apart from the call sites. */
	others: SymbolReference[];
}

export function omission(item: ContextItem, reason: OmissionReason): ContextOmission {
	return { ...item, reason };
}

/** The declaration's own lines. */
export function sourceItem(symbol: ChangedSymbol): ContextItem {
	return {
		kind: 'source',
		path: symbol.file,
		startLine: symbol.startLine,
		endLine: symbol.endLine,
		symbol: symbol.qualifiedName
	};
}

/** Why a caller made the list: the changed behavior it relies on, or the group `callerOrder` put it in. */
function callerWhy(ref: SymbolReference): string {
	if (ref.dependsOn) return `relies on the changed ${ref.dependsOn.join(', ')}`;
	if (ref.kind === 'test') return 'test that uses it';

	return ref.inDiff ? 'call this diff adds' : 'call outside the diff';
}

function callerItem(symbol: ChangedSymbol, ref: SymbolReference): ContextItem {
	return {
		kind: ref.kind === 'test' ? 'test' : 'caller',
		path: ref.file,
		startLine: ref.line,
		symbol: symbol.qualifiedName,
		why: callerWhy(ref)
	};
}

/** Why the block states a contract: the declaration went away, its signature or export changed, or a behavior did. */
function contractWhy(symbol: ChangedSymbol): string {
	if (symbol.change === 'deleted') return 'declaration deleted';
	if (symbol.previousSignature !== undefined) return 'signature or export changed';

	return `changed ${symbol.behavior?.join(', ')}${symbol.doc ? ', documented' : ''}`;
}

/**
 * Every place one symbol's block puts in the prompt, and every caller,
 * reference and test it leaves out, each with one reason: every caller when
 * the contract did not change (callers are listed only when it did), every
 * caller dropped with the call sites to fit the block, every caller past the
 * caller cap, and every reference or test past its cap. Each caller found is
 * then either listed or omitted, with caller selection on or off; one left
 * out may still appear among the plain references.
 */
export function suppliedBy(
	symbol: ChangedSymbol,
	{ changed, withCallers, shown, others }: Shown
): { supplied: ContextItem[]; omitted: ContextOmission[] } {
	const about = { symbol: symbol.qualifiedName };

	const reference = (ref: SymbolReference) => ({
		kind: 'reference' as const,
		path: ref.file,
		startLine: ref.line,
		...about
	});

	const test = (path: string) => ({ kind: 'test' as const, path, ...about });

	const supplied: ContextItem[] = [
		sourceItem(symbol),
		...(changed
			? [
					{
						kind: 'contract' as const,
						path: symbol.file,
						startLine: symbol.startLine,
						...about,
						why: contractWhy(symbol)
					}
				]
			: []),
		...shown.map((ref) => callerItem(symbol, ref)),
		...others.map(reference),
		...symbol.tests.map(test),
		...symbol.examples.map((example) => ({
			kind: 'sibling' as const,
			path: example.file,
			startLine: example.startLine,
			endLine: example.endLine,
			symbol: example.qualifiedName
		}))
	];

	const callers = (refs: SymbolReference[] | undefined, reason: OmissionReason) =>
		(refs ?? []).map((ref) => omission(callerItem(symbol, ref), reason));

	return {
		supplied,
		omitted: [
			...(changed
				? [
						...(withCallers ? [] : callers(symbol.callers, 'context-cap')),
						...callers(symbol.omittedCallers, 'caller-cap')
					]
				: callers([...(symbol.callers ?? []), ...(symbol.omittedCallers ?? [])], 'contract-unchanged')),
			...(symbol.omittedReferences ?? []).map((ref) => omission(reference(ref), 'reference-cap')),
			...(symbol.omittedTests ?? []).map((path) => omission(test(path), 'test-cap'))
		]
	};
}
