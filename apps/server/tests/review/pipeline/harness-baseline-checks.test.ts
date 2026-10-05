import { expect, test } from 'bun:test';
import type { SetupReport } from '../../../src/sandbox/workspace-setup';
import { pickBaselineChecks, pickPatchChecks } from '../../../src/review/pipeline/harness/baseline-checks';

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

test('a patch runs only the type check and lint of the packages it edits', () => {
	expect(pickPatchChecks(SCRIPTS, ['apps/web/src/a.ts', 'apps/server/src/b.ts'], BUN)).toEqual([
		'cd apps/server && bun run lint',
		'cd apps/web && bun run typecheck'
	]);
});

test('a vitest suite runs only the tests in the folders of the changed code files', () => {
	const scripts = ['.: test → tsc -p tsconfig.spec.json && vp test --run', '.: lint → eslint .'];
	const pnpm = { ...BUN, steps: [{ ...BUN.steps[0], command: 'pnpm install --frozen-lockfile' }] };

	const checks = pickBaselineChecks(
		scripts,
		[
			'src/middleware/rate-limit/store.ts',
			'src/middleware/rate-limit/index.test.ts',
			'src/utils/cookie.ts',
			'README.md'
		],
		pnpm
	);

	expect(checks).toEqual(['pnpm run lint', 'pnpm run test middleware/rate-limit/ utils/ --passWithNoTests']);
});

test('a test suite runs whole when a changed code file sits at the top of the package', () => {
	const scripts = ['apps/api: test → vitest run'];

	expect(pickBaselineChecks(scripts, ['apps/api/src/index.ts', 'apps/api/src/forge/gh.ts'], BUN)).toEqual([
		'cd apps/api && bun run test'
	]);
});
