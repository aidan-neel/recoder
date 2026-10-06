import { isScriptLanguage } from './imports.js';
import { languageFor } from './languages.js';
import { byCodePoint } from './repo.js';
import type { SymbolReference } from './types.js';

/** Call sites and tests kept per symbol, so the prompt shows the evidence without growing with the repo. */
const MAX_CALLERS = 5;
/** Callers past the cap kept by name, so a report can say which ones the prompt left out. */
const MAX_OMITTED = 20;

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

/** Call sites outside the diff first, then those it adds, then tests; each by file and line. */
function callerOrder(a: SymbolReference, b: SymbolReference): number {
	const group = (ref: SymbolReference) => (ref.kind === 'test' ? 2 : ref.inDiff ? 1 : 0);

	return group(a) - group(b) || byCodePoint(a.file, b.file) || a.line - b.line;
}

/**
 * The calls and tests that use a symbol, up to the cap, and those the cap cut.
 * For script languages a hit in another file counts only when that file
 * imports the symbol's module, so a method of the same name elsewhere is not a caller.
 */
export function pickCallers(language: string, file: string, resolved: ResolvedReference[]): PickedCallers {
	const script = isScriptLanguage(language);

	const ordered = resolved
		.filter(({ ref, imports }) => {
			if (ref.kind !== 'call' && ref.kind !== 'test') return false;
			if (!sameFamily(ref.file, language)) return false;

			return !script || ref.file === file || imports === true;
		})
		.map(({ ref }) => ref)
		.sort(callerOrder);

	return { callers: ordered.slice(0, MAX_CALLERS), omitted: ordered.slice(MAX_CALLERS, MAX_CALLERS + MAX_OMITTED) };
}
