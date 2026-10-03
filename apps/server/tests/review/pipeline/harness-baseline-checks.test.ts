import { expect, test } from 'bun:test';
import type { SetupReport } from '../../../src/sandbox/exec-workspace';
import { pickBaselineChecks } from '../../../src/review/pipeline/harness/baseline-checks';

const BUN: SetupReport = {
	steps: [
		{
			marker: 'bun.lock',
			command: 'bun install --frozen-lockfile --ignore-scripts',
			exitCode: 0,
			output: '',
			elapsedMs: 1
		}
	],
	missing: []
};

const SCRIPTS = [
	'.: lint → eslint .',
	'apps/web: check → svelte-check',
	'apps/web: typecheck → tsc',
	'apps/web: test → vitest',
	'apps/web/src/inner: test → vitest',
	'apps/server: lint → eslint src',
	'apps/server: dev → bun --watch'
];

test('each changed file runs the checks of the package that owns it, with the tool the install used', () => {
	const checks = pickBaselineChecks(SCRIPTS, ['apps/web/src/a.ts', 'apps/server/src/b.ts', 'README.md'], BUN);

	expect(checks).toEqual([
		'bun run lint',
		'cd apps/server && bun run lint',
		'cd apps/web && bun run typecheck',
		'cd apps/web && bun run test'
	]);
});

test('a package dir that is not safe to put in a shell command unquoted is skipped', () => {
	const scripts = ['apps/x;rm -rf ~: test → vitest', '$(id): lint → eslint'];

	expect(pickBaselineChecks(scripts, ['apps/x;rm -rf ~/a.ts', '$(id)/b.ts'], BUN)).toEqual([]);
});

test('nothing runs when no JavaScript package manager was installed', () => {
	expect(pickBaselineChecks(SCRIPTS, ['apps/web/src/a.ts'], { steps: [], missing: ['bun'] })).toEqual([]);
	expect(pickBaselineChecks(SCRIPTS, ['apps/web/src/a.ts'], null)).toEqual([]);
});
