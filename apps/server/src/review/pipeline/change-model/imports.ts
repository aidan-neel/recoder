import { posix } from 'node:path';
import type { Node } from 'web-tree-sitter';

/** Languages whose files import each other by path, so a hit can be tied to the module it came from. */
const SCRIPT_LANGUAGES = new Set(['typescript', 'tsx', 'javascript', 'svelte']);

/** Import aliases that stand for a source folder: `$lib/a`, `@/a`, `~/a`, `#a`. */
const ALIAS = /^(\$[\w-]+\/|@\/|~\/|#)/;

/** A script extension, which an import may leave off or swap (`./a.js` for `a.ts`). */
const SCRIPT_EXTENSION = /\.(d\.)?[cm]?[jt]sx?$/;

export function isScriptLanguage(language: string): boolean {
	return SCRIPT_LANGUAGES.has(language);
}

/** The text of a plain string literal node without its quotes, or null for anything else. */
function stringValue(node: Node | null): string | null {
	return node?.type === 'string' ? node.text.slice(1, -1) : null;
}

/** The module an `import`, `export … from`, `require(…)` or `import(…)` node names, else null. */
export function specifierOf(node: Node): string | null {
	if (node.type === 'import_statement' || node.type === 'export_statement') {
		return stringValue(node.childForFieldName('source'));
	}

	if (node.type !== 'call_expression') return null;

	const callee = node.childForFieldName('function');

	if (callee?.type !== 'import' && !(callee?.type === 'identifier' && callee.text === 'require')) return null;

	return stringValue(node.childForFieldName('arguments')?.namedChildren[0] ?? null);
}

function withoutExtension(path: string): string {
	return path.replace(SCRIPT_EXTENSION, '');
}

/** Whether an import path (extension optional, folders resolving to their index) names `target`. */
function namesFile(target: string, path: string): boolean {
	const wanted = withoutExtension(target);
	const base = withoutExtension(path === '.' ? '' : path);

	return wanted === base || wanted === (base ? `${base}/index` : 'index');
}

/** Whether `target` ends with the alias's path below its root folder. */
function aliasNames(target: string, specifier: string): boolean {
	const rest = specifier.replace(ALIAS, '');

	if (!rest) return false;

	const wanted = withoutExtension(target);
	const path = withoutExtension(rest);

	return [path, `${path}/index`].some((candidate) => wanted === candidate || wanted.endsWith(`/${candidate}`));
}

/** A bare package whose name is a folder on the target's path, such as `@scope/shared` for `packages/shared/…`. */
function maybeWorkspace(target: string, specifier: string): boolean {
	return target.split('/').includes(specifier.slice(specifier.lastIndexOf('/') + 1));
}

/**
 * Whether the importing file imports the module `target`: true when one of its
 * specifiers resolves to it (relative paths, index files, extensionless and
 * swapped extensions, `$lib`-style aliases), undefined when a bare package
 * name could be it, false when none can be. The target file imports itself.
 */
export function importsModule(importer: string, specifiers: string[], target: string): boolean | undefined {
	if (importer === target) return true;

	let maybe = false;

	for (const specifier of specifiers) {
		if (specifier.startsWith('.')) {
			if (namesFile(target, posix.normalize(posix.join(posix.dirname(importer), specifier)).replace(/\/$/, ''))) {
				return true;
			}
		} else if (ALIAS.test(specifier)) {
			if (aliasNames(target, specifier)) return true;
		} else if (maybeWorkspace(target, specifier)) {
			maybe = true;
		}
	}

	return maybe ? undefined : false;
}
