import { isScriptLanguage } from './imports.js';
import { languageFor } from './languages.js';
import { byCodePoint } from './repo.js';
import type { BehaviorAspect, SymbolReference } from './types.js';

/** Call sites and tests kept per symbol, so the prompt shows the evidence without growing with the repo. */
const MAX_CALLERS = 5;

/** Callers, references or tests past their cap kept by place, so a report can say which ones the prompt left out. */
export const MAX_OMITTED = 20;

/** The callers kept for the prompt, and the next ones the cap cut, in the same order. */
export interface PickedCallers {
	callers: SymbolReference[];
	omitted: SymbolReference[];
}

/** A reference with what the search learned about the file it is in. */
export interface ResolvedReference {
	ref: SymbolReference;
	/** Whether the file imports the symbol's module; undefined when that can't be told. */
	imports: boolean | undefined;
}

/** Whether a file is written in the symbol's language family, so a same-name word there can be a use of it. */
function sameFamily(file: string, language: string): boolean {
	const other = languageFor(file);

	return other !== null && (other === language || (isScriptLanguage(other) && isScriptLanguage(language)));
}

/** Call sites outside the diff first, then those it adds, then tests. */
function group(ref: SymbolReference): number {
	return ref.kind === 'test' ? 2 : ref.inDiff ? 1 : 0;
}

function byPlace(a: SymbolReference, b: SymbolReference): number {
	return byCodePoint(a.file, b.file) || a.line - b.line;
}

/** `group` first, then file and line. */
function callerOrder(a: SymbolReference, b: SymbolReference): number {
	return group(a) - group(b) || byPlace(a, b);
}

/**
 * Each caller marked with the changed behaviors it relies on; within its
 * `group`, those relying on more rank first. A tag never lifts a caller out
 * of its group, so a tagged test still follows every production caller.
 */
function byDependence(refs: SymbolReference[], depends: (ref: SymbolReference) => BehaviorAspect[]): SymbolReference[] {
	return refs
		.map((ref) => {
			const dependsOn = depends(ref);

			return dependsOn.length ? { ...ref, dependsOn } : ref;
		})
		.sort((a, b) => group(a) - group(b) || (b.dependsOn?.length ?? 0) - (a.dependsOn?.length ?? 0) || byPlace(a, b));
}

/**
 * The calls and tests that use a symbol, up to the cap, and those the cap cut.
 * For script languages a hit in another file counts only when that file
 * imports the symbol's module, so a method of the same name elsewhere is not a caller.
 * With `depends`, callers that rely on the changed behavior rank first within their group; the cap is the same.
 */
export function pickCallers(
	language: string,
	file: string,
	resolved: ResolvedReference[],
	depends?: (ref: SymbolReference) => BehaviorAspect[]
): PickedCallers {
	const script = isScriptLanguage(language);

	const ordered = resolved
		.filter(({ ref, imports }) => {
			if (ref.kind !== 'call' && ref.kind !== 'test') return false;
			if (!sameFamily(ref.file, language)) return false;

			return !script || ref.file === file || imports === true;
		})
		.map(({ ref }) => ref)
		.sort(callerOrder);

	const ranked = depends ? byDependence(ordered, depends) : ordered;

	return { callers: ranked.slice(0, MAX_CALLERS), omitted: ranked.slice(MAX_CALLERS, MAX_CALLERS + MAX_OMITTED) };
}
