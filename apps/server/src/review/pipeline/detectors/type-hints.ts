import { dirname, join, resolve } from 'node:path';
import ts from 'typescript5';
import type { AddedLines } from './changed-lines.js';
import type { DetectorResult } from './types.js';
import { insideTypeHintRoot, typeHintProjects } from './type-hint-projects.js';

/** Tsconfigs read per review, so a monorepo cannot turn this into a full build. */
const MAX_PROJECTS = 3;

/** Source files in a project beyond which the program costs more than the hints are worth. */
const MAX_PROJECT_FILES = 3000;

/**
 * Whether the compiler may read `path`: the compiler's own libs, anything the
 * install put under the checkout's `node_modules` (a package manager links
 * those to a store outside it), and otherwise only real paths inside the checkout.
 */
function readable(root: string, libDir: string, path: string): boolean {
	const lexical = resolve(path);

	if (lexical.startsWith(`${libDir}/`)) return true;
	if (lexical.startsWith(`${root}/`) && lexical.includes('/node_modules/')) return true;

	return insideTypeHintRoot(root, path);
}

/** A compiler host that reads nothing outside the checkout. */
function confinedHost(root: string, options: ts.CompilerOptions): ts.CompilerHost {
	const host = ts.createCompilerHost(options, true);
	const readFile = host.readFile.bind(host);
	const fileExists = host.fileExists.bind(host);

	const libDir = resolve(host.getDefaultLibLocation?.() ?? dirname(ts.getDefaultLibFilePath(options)));

	host.readFile = (path) => (readable(root, libDir, path) ? readFile(path) : undefined);
	host.fileExists = (path) => fileExists(path) && readable(root, libDir, path);

	return host;
}

/** Whether a call's type is a thenable, which a statement drops when nothing awaits it. */
function isPromiseLike(checker: ts.TypeChecker, type: ts.Type): boolean {
	const then = type.getProperty('then');

	if (!then) return false;

	return checker.getTypeOfSymbol(then).getCallSignatures().length > 0;
}

/** An expression statement whose call returns a promise nothing awaits, handles or voids. */
function floatingPromise(checker: ts.TypeChecker, node: ts.Node): boolean {
	if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;

	const call = node.expression;

	if (ts.isPropertyAccessExpression(call.expression) && /^(catch|finally)$/.test(call.expression.name.text))
		return false;

	return isPromiseLike(checker, checker.getTypeAtLocation(call));
}

/** A switch over a union of literals that names fewer members than the union has and has no default. */
function missingCases(checker: ts.TypeChecker, node: ts.Node): string[] {
	if (!ts.isSwitchStatement(node)) return [];
	if (node.caseBlock.clauses.some(ts.isDefaultClause)) return [];

	const type = checker.getTypeAtLocation(node.expression);

	if (!type.isUnion() || !type.types.every((member) => member.isLiteral())) return [];

	const named = new Set(
		node.caseBlock.clauses
			.filter(ts.isCaseClause)
			.map((clause) => checker.getTypeAtLocation(clause.expression))
			.filter((member) => member.isLiteral())
			.map((member) => (member as ts.LiteralType).value)
	);

	return type.types
		.filter((member) => !named.has((member as ts.LiteralType).value))
		.map((member) => checker.typeToString(member));
}

/** The type-hint results of one file's added lines. */
function hintsInFile(program: ts.Program, file: string, root: string, lines: Map<number, string>): DetectorResult[] {
	const source = program.getSourceFile(join(root, file));

	if (!source) return [];

	const checker = program.getTypeChecker();
	const results: DetectorResult[] = [];

	const visit = (node: ts.Node): void => {
		const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

		if (lines.has(line)) {
			if (floatingPromise(checker, node)) {
				results.push({
					detector: 'type-hint',
					category: 'correctness',
					title: 'Promise is neither awaited nor handled',
					body: 'This statement calls a function that returns a promise and drops it. A rejection becomes an unhandled rejection, and later code runs before the call finishes.',
					file,
					line,
					ruleId: 'floating-promise',
					evidence: `typescript type of the call: ${checker.typeToString(checker.getTypeAtLocation((node as ts.ExpressionStatement).expression))}`,
					suspected: true
				});
			}

			const missing = missingCases(checker, node);

			if (missing.length) {
				results.push({
					detector: 'type-hint',
					category: 'correctness',
					title: 'Switch does not handle every member of its union',
					body: `This switch has no default and no case for ${missing.map((name) => `\`${name}\``).join(', ')}, so those values fall through silently.`,
					file,
					line,
					ruleId: 'non-exhaustive-switch',
					evidence: `typescript union members with no case: ${missing.join(', ')}`,
					suspected: true
				});
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(source);

	return results;
}

/**
 * Hints only the compiler's types can give, on lines the change adds: a
 * dropped promise, a switch over a union that misses members. Reads the
 * installed checkout through the repo's own tsconfig, and reads nothing
 * outside it. Every result is `suspected`, so a verifier settles it. Returns
 * nothing when the checkout has no tsconfig or TypeScript cannot load it.
 */
export function typeHintResults(
	root: string,
	added: AddedLines,
	byConfig = typeHintProjects(root, added)
): DetectorResult[] {
	const real = resolve(root);
	const results: DetectorResult[] = [];

	for (const [config, files] of [...byConfig].slice(0, MAX_PROJECTS)) {
		const read = ts.getParsedCommandLineOfConfigFile(
			config,
			{ noEmit: true },
			{ ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined }
		);

		if (!read || read.fileNames.length > MAX_PROJECT_FILES) continue;

		const program = ts.createProgram({
			rootNames: read.fileNames,
			options: { ...read.options, noEmit: true },
			host: confinedHost(real, read.options)
		});

		for (const file of files) results.push(...hintsInFile(program, file, real, added.get(file)!));
	}

	return results;
}
