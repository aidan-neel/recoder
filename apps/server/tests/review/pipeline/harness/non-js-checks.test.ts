import { expect, test } from 'bun:test';
import type { CommitTree } from '../../../../src/sandbox/commit-tree';
import { nonJsChecks } from '../../../../src/review/pipeline/harness/non-js-checks';
import { fakeBin } from '../../../helpers/fake-bin';

function tree(files: Record<string, string>): CommitTree {
	return {
		sizes: new Map(Object.entries(files).map(([name, text]) => [name, text.length])),
		read: async (path) => files[path] ?? null
	};
}

test('Python checks honor pytest configuration and preserve a failing pytest exit instead of falling back', async () => {
	for (const [name, config] of [
		['pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]'],
		['tox.ini', '[testenv]\ncommands = pytest {posargs}'],
		['setup.cfg', '[tool:pytest]\ntestpaths = tests']
	]) {
		const checks = await nonJsChecks(tree({ [name]: config, 'tests/test_feature.py': '', 'pkg/a.py': '' }), [
			'pkg/a.py'
		]);

		expect(checks).toEqual([
			"if python -c 'import pytest' >/dev/null 2>&1; then python -m pytest; else python -m unittest discover -s tests; fi"
		]);
	}
});

test('an explicit unittest runner is respected even on a host with pytest', async () => {
	expect(
		await nonJsChecks(tree({ 'setup.cfg': '[test]\ncommand = python -m unittest', 'test_a.py': '' }), ['test_a.py'])
	).toEqual(['python -m unittest discover']);
});

test('Go checks run in the owning module, not the monorepo root', async () => {
	const files = tree({ 'go.mod': '', 'services/api/go.mod': '', 'services/api/main.go': '', 'other/main.go': '' });

	expect(await nonJsChecks(files, ['services/api/main.go'])).toEqual([
		'cd services/api && go test ./...',
		'cd services/api && go vet ./...'
	]);
});

test('unrecognized repositories and shell-bearing project paths yield no checks', async () => {
	expect(
		await nonJsChecks(tree({ 'readme.md': '', 'x;echo bad/go.mod': '' }), ['readme.md', 'x;echo bad/a.go'])
	).toEqual([]);
});

test('pytest failures are not hidden by unittest and a missing pytest falls back to discovery', async () => {
	const checks = await nonJsChecks(tree({ 'test_feature.py': '' }), ['test_feature.py']);

	const { env } = await fakeBin(
		'python',
		'#!/bin/sh\nif [ "$1" = "-c" ]; then exit "$PROBE"; fi\necho "$2"\nif [ "$2" = "pytest" ]; then exit 7; fi\n'
	);

	for (const [probe, code, runner] of [
		['0', 7, 'pytest'],
		['1', 0, 'unittest']
	] as const) {
		const result = Bun.spawn(['sh', '-c', checks[0]!], {
			env: { ...env, PROBE: probe },
			stdout: 'pipe',
			stderr: 'pipe'
		});

		expect(await result.exited).toBe(code);
		expect((await new Response(result.stdout).text()).trim()).toBe(runner);
	}
});
