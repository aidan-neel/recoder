import { byCodePoint } from '@recoder/shared';
import { isTestPath } from '../change-model/test-files.js';
import type { RepoFile, RepoInventory } from './repo-inventory.js';

/** Files that make their folder a package root. */
const MANIFESTS = new Set([
	'package.json',
	'go.mod',
	'Cargo.toml',
	'pyproject.toml',
	'setup.py',
	'pom.xml',
	'build.gradle',
	'build.gradle.kts',
	'composer.json',
	'Gemfile',
	'mix.exs'
]);

const MAX_PACKAGES = 12;
const MAX_FOLDERS = 8;
const MAX_LANGUAGES = 2;

/** A test file in its own test folder, not beside the code it tests. */
const TEST_FOLDER = /(^|\/)(tests?|__tests__|spec)\//;

/**
 * A short map of the repository for reviewers: its packages with their size,
 * main languages and where their tests live, and the folders the change
 * touches. It tells a reviewer where to look before it searches. Generated
 * and excluded files are not counted. The same commit and change always give
 * the same text.
 */
export function repoMap(repo: RepoInventory, changedPaths: string[]): string {
	const files = repo.files.filter((file) => !file.excludeReason);
	const roots = packageRoots(files);
	const packages = groupBy(files, (file) => packageOf(file.path, roots));
	const ranked = [...packages].sort(([a, left], [b, right]) => right.length - left.length || byCodePoint(a, b));
	const shown = ranked.slice(0, MAX_PACKAGES).map(([root, members]) => `- ${root || '(root)'}: ${describe(members)}`);
	const more = ranked.length > MAX_PACKAGES ? [`- …${ranked.length - MAX_PACKAGES} more packages`] : [];

	return [
		`${files.length} files in ${packages.size} package${packages.size === 1 ? '' : 's'}:`,
		...shown,
		...more,
		...changedFolderLines(files, changedPaths)
	].join('\n');
}

/** Folders that hold a manifest, deepest first, so a file belongs to its nearest package. */
function packageRoots(files: RepoFile[]): string[] {
	const roots = files.filter((file) => MANIFESTS.has(baseName(file.path))).map((file) => folderOf(file.path));

	return [...new Set(roots)].sort((a, b) => b.length - a.length || byCodePoint(a, b));
}

/** The nearest package root above a path; the repo root when no manifest covers it. */
function packageOf(path: string, roots: string[]): string {
	return roots.find((root) => root === '' || path.startsWith(`${root}/`)) ?? '';
}

/** `412 files (typescript 380, svelte 12); 120 tests in test folders` */
function describe(members: RepoFile[]): string {
	const languages = [
		...groupBy(
			members.filter((file) => file.language),
			(file) => file.language ?? ''
		)
	]
		.sort(([a, left], [b, right]) => right.length - left.length || byCodePoint(a, b))
		.slice(0, MAX_LANGUAGES)
		.map(([language, group]) => `${language} ${group.length}`);

	const tests = members.filter((file) => isTestPath(file.path));
	const place = testPlace(tests);
	const testText = tests.length ? `; ${tests.length} test${tests.length === 1 ? '' : 's'} ${place}` : '; no tests';

	return `${members.length} files${languages.length ? ` (${languages.join(', ')})` : ''}${testText}`;
}

function testPlace(tests: RepoFile[]): string {
	const inFolders = tests.filter((file) => TEST_FOLDER.test(file.path)).length;

	if (inFolders === tests.length) return 'in test folders';
	if (inFolders === 0) return 'next to the code';

	return 'in test folders and next to the code';
}

/** The folders of the changed files that exist at the head, with how many files each holds. */
function changedFolderLines(files: RepoFile[], changedPaths: string[]): string[] {
	const folders = [...new Set(changedPaths.map(folderOf))].sort(byCodePoint);
	const sizes = groupBy(files, (file) => folderOf(file.path));

	const lines = folders.flatMap((folder) => {
		const count = sizes.get(folder)?.length;

		return count ? [`- ${folder || '(root)'}: ${count} file${count === 1 ? '' : 's'}`] : [];
	});

	if (!lines.length) return [];

	const more = lines.length > MAX_FOLDERS ? [`- …${lines.length - MAX_FOLDERS} more folders`] : [];

	return ['Folders the change touches:', ...lines.slice(0, MAX_FOLDERS), ...more];
}

function groupBy(files: RepoFile[], keyOf: (file: RepoFile) => string): Map<string, RepoFile[]> {
	const groups = new Map<string, RepoFile[]>();

	for (const file of files) {
		const key = keyOf(file);
		const group = groups.get(key);

		if (group) group.push(file);
		else groups.set(key, [file]);
	}

	return groups;
}

function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');

	return slash < 0 ? '' : path.slice(0, slash);
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
