import { dirname } from 'node:path/posix';
import type { CommitTree } from '../../../sandbox/commit-tree.js';
import { owningDir, PLAIN_DIR } from './baseline-checks.js';

const PYTHON_MARKERS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini'];

/** Runner hints only; commands from project configuration never become shell code. */
function pythonCommand(config: string, tests: boolean): string {
	const unittest = /\b(?:python\S*\s+-m\s+)?unittest\b/.test(config);
	const pytest = /\[(?:tool\.pytest\.ini_options|tool:pytest|pytest)\]|\bpytest\b/.test(config);
	const fallback = `python -m unittest discover${tests ? ' -s tests' : ''}`;

	if (unittest && !pytest) return fallback;

	return `if python -c 'import pytest' >/dev/null 2>&1; then python -m pytest; else ${fallback}; fi`;
}

/** Checks for Python projects and Go modules owning changed files, using only tracked manifests. */
export async function nonJsChecks(tree: CommitTree, paths: string[]): Promise<string[]> {
	const files = [...tree.sizes.keys()];

	const dirs = (markers: string[]) =>
		[...new Set(files.filter((file) => markers.includes(file.split('/').at(-1)!)).map(dirname))].filter(
			(dir) => dir === '.' || (PLAIN_DIR.test(dir) && !dir.split('/').includes('..'))
		);

	const owned = (projects: string[]) =>
		[...new Set(paths.map((path) => owningDir(path, projects)).filter((dir): dir is string => dir !== null))].sort();

	const commands: string[] = [];
	const at = (dir: string, command: string) => (dir === '.' ? command : `cd ${dir} && ${command}`);

	const pythonDirs = dirs(PYTHON_MARKERS);

	if (pythonDirs.length === 0 && files.some((file) => file.endsWith('.py'))) pythonDirs.push('.');

	for (const dir of owned(pythonDirs)) {
		const prefix = dir === '.' ? '' : `${dir}/`;

		const config = (
			await Promise.all(
				PYTHON_MARKERS.filter((name) => (tree.sizes.get(prefix + name) ?? Infinity) <= 64_000).map((name) =>
					tree.read(prefix + name)
				)
			)
		).join('\n');

		const tests = files.some((file) => file.startsWith(`${prefix}tests/`) && file.endsWith('.py'));

		commands.push(at(dir, pythonCommand(config, tests)));
	}

	for (const dir of owned(dirs(['go.mod']))) {
		commands.push(at(dir, 'go test ./...'), at(dir, 'go vet ./...'));
	}

	return commands;
}
