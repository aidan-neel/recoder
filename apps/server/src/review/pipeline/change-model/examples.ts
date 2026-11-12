import { repoPaths, type RepoInventory } from '../repo-inventory/repo-inventory.js';
import { languageFor } from './languages.js';
import { parseRepoFiles } from './parsed-files.js';
import { mapLimit } from '../../../util/map-limit.js';
import { byCodePoint } from './repo.js';
import type { ParsedSymbol } from './symbols.js';
import { isTestPath } from './test-files.js';
import type { SymbolRange } from './types.js';

const MAX_EXAMPLES = 3;
/** Files read per folder when looking for comparable declarations. */
const FILES_PER_FOLDER = 16;

/** A symbol as example search needs it. */
type Target = Pick<ParsedSymbol, 'file' | 'kind' | 'exported' | 'language'>;

function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');

	return slash < 0 ? '' : path.slice(0, slash);
}

/** The role a file name signals: `stage` for `change-model-stage.ts`, `test` for `a.test.ts`; empty when none. */
function roleOf(path: string): string {
	const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
	const cut = Math.max(stem.lastIndexOf('-'), stem.lastIndexOf('.'), stem.lastIndexOf('_'));

	return cut < 0 ? '' : stem.slice(cut + 1).toLowerCase();
}

/** The same-language files in each folder, parsed once each; keyed by folder, filled in sorted order. */
async function folderSymbols(
	root: string,
	repo: RepoInventory,
	targets: Target[],
	signal: AbortSignal
): Promise<Map<string, ParsedSymbol[]>> {
	const keys = [...new Set(targets.map((target) => `${target.language}\0${folderOf(target.file)}`))].sort(byCodePoint);
	const paths = repoPaths(repo);

	const parsed = await mapLimit(keys, 4, async (key) => {
		const [language, folder] = key.split('\0');

		const files = paths
			.filter((path) => folderOf(path) === folder && languageFor(path) === language)
			.slice(0, FILES_PER_FOLDER);

		const symbols = await parseRepoFiles(root, repo, files, signal);

		return files.flatMap((path) => symbols.get(path) ?? []);
	});

	return new Map(keys.map((key, index) => [key, parsed[index]]));
}

/** Ranks a candidate: other files with the same role first, then other files, then the same file; matching export next. */
function rank(target: Target, candidate: ParsedSymbol): number[] {
	const group =
		candidate.file === target.file
			? 2
			: roleOf(candidate.file) && roleOf(candidate.file) === roleOf(target.file)
				? 0
				: 1;

	return [group, candidate.exported === target.exported ? 0 : 1];
}

/**
 * Up to three existing declarations like each target: the same kind, in the
 * same folder, never a changed symbol, and never a test for a non-test target.
 * Results are in the same order as `targets`.
 */
export async function findExamples(
	root: string,
	repo: RepoInventory,
	targets: Target[],
	changed: Set<string>,
	signal: AbortSignal
): Promise<SymbolRange[][]> {
	const byFolder = await folderSymbols(root, repo, targets, signal);

	return targets.map((target) => {
		const pool = byFolder.get(`${target.language}\0${folderOf(target.file)}`) ?? [];
		const testTarget = isTestPath(target.file);

		const candidates = pool.filter(
			(candidate) =>
				candidate.kind === target.kind &&
				!changed.has(`${candidate.file}\0${candidate.qualifiedName}`) &&
				(testTarget || !isTestPath(candidate.file))
		);

		const ranked = candidates
			.map((candidate) => ({ candidate, key: rank(target, candidate) }))
			.sort(
				(a, b) =>
					a.key[0] - b.key[0] ||
					a.key[1] - b.key[1] ||
					byCodePoint(a.candidate.file, b.candidate.file) ||
					a.candidate.startLine - b.candidate.startLine
			);

		return ranked.slice(0, MAX_EXAMPLES).map(({ candidate }) => ({
			name: candidate.name,
			qualifiedName: candidate.qualifiedName,
			kind: candidate.kind,
			file: candidate.file,
			startLine: candidate.startLine,
			endLine: candidate.endLine
		}));
	});
}
