import { posix } from 'node:path';
import type { BaselineResult } from '../harness/types.js';
import { clip, type AddedLines } from './changed-lines.js';
import { parseDiagnostics, type RawDiagnostic } from './parse-diagnostics.js';
import type { DetectorResult } from './types.js';

/** Rules whose diagnostic means unused code. */
const DEAD_CODE_RULES = new Set(['TS6133', 'TS6138', 'TS6192', 'TS6196', 'TS6198', 'F401', 'F811', 'F841']);

/** Rules whose diagnostic means a function grew too complex. */
const COMPLEXITY_RULES = new Set([
	'complexity',
	'max-depth',
	'max-params',
	'max-statements',
	'max-nested-callbacks',
	'max-lines-per-function',
	'sonarjs/cognitive-complexity',
	'C901'
]);

/** Commands whose plain `file:line:col: message` output is a linter's rather than a compiler's. */
const LINT_COMMAND = /\b(lint|eslint|ruff|flake8|pylint|vet|clippy|biome|oxlint)\b/;

/** The package dir a baseline command runs in, from its `cd <dir> &&` prefix. */
function commandDir(command: string): string {
	return /^cd ([^\s&;|]+) && /.exec(command)?.[1] ?? '.';
}

/**
 * The changed path a diagnostic's path names: an absolute path by its longest
 * changed-path suffix, a relative one against the command's dir or the repo
 * root. Null when it names no changed file.
 */
function resolveDiagnosticPath(raw: string, dir: string, added: AddedLines): string | null {
	const path = raw
		.trim()
		.replace(/^["']|["']$/g, '')
		.replace(/\\/g, '/');

	if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
		const suffix = [...added.keys()].filter((changed) => path.endsWith(`/${changed}`));

		return suffix.sort((a, b) => b.length - a.length)[0] ?? null;
	}

	const candidates = [posix.normalize(posix.join(dir, path)), posix.normalize(path)];

	return candidates.find((candidate) => added.has(candidate)) ?? null;
}

function categoryOf(detector: 'typecheck' | 'lint', rule: string | undefined): DetectorResult['category'] {
	const name = rule ?? '';

	if (DEAD_CODE_RULES.has(name) || /(^|\/)no-unused-|unused-imports\/|^unused_/.test(name)) return 'dead-code';
	if (COMPLEXITY_RULES.has(name)) return 'complexity';

	return detector === 'typecheck' ? 'correctness' : 'convention';
}

function detectorOf(diagnostic: RawDiagnostic, command: string): 'typecheck' | 'lint' {
	if (diagnostic.source !== 'either') return diagnostic.source;

	return LINT_COMMAND.test(command) ? 'lint' : 'typecheck';
}

function toResult(diagnostic: RawDiagnostic, file: string, check: BaselineResult): DetectorResult {
	const detector = detectorOf(diagnostic, check.command);
	const rule = diagnostic.rule ? ` (\`${diagnostic.rule}\`)` : '';
	const message = clip(diagnostic.message, 400).replace(/\.$/, '');

	const body =
		detector === 'typecheck'
			? `The type check \`${check.command}\` fails on this added line: ${message}${rule}.`
			: `The repo's linter \`${check.command}\` flags this added line: ${message}${rule}.`;

	return {
		detector,
		category: categoryOf(detector, diagnostic.rule),
		title: clip(diagnostic.message, 80),
		body,
		file,
		line: diagnostic.line,
		evidence: `${check.evidenceId ?? check.command}: ${clip(diagnostic.raw, 300)}`
	};
}

/**
 * Type check and lint diagnostics from the baseline runs that land on lines
 * the diff adds; anything on unchanged code predates the change. A diagnostic
 * two checks both print is reported once.
 */
export function diagnosticResults(baseline: BaselineResult[], added: AddedLines): DetectorResult[] {
	const seen = new Set<string>();
	const results: DetectorResult[] = [];

	for (const check of baseline) {
		const dir = commandDir(check.command);

		for (const diagnostic of parseDiagnostics(check.output)) {
			const file = resolveDiagnosticPath(diagnostic.path, dir, added);

			if (!file || !added.get(file)?.has(diagnostic.line)) continue;

			const key = `${file}:${diagnostic.line}:${diagnostic.message}`;

			if (seen.has(key)) continue;

			seen.add(key);
			results.push(toResult(diagnostic, file, check));
		}
	}

	return results;
}
