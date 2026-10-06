import { expect, test } from 'bun:test';
import { buildProfiles, stepRunner } from '../../../../src/review/pipeline/harness/exec-profile';
import type { CommitTree } from '../../../../src/sandbox/exec-workspace';

/** A commit held in memory: path → content. */
function tree(files: Record<string, string>): CommitTree {
	const entries = new Map(Object.entries(files));

	return {
		sizes: new Map([...entries].map(([path, content]) => [path, content.length])),
		read: async (path) => entries.get(path) ?? null
	};
}

const manifest = (fields: Record<string, unknown>) => JSON.stringify(fields);

/** A Svelte monorepo shaped like the one in the issue: a SvelteKit docs app tested by vitest, and a component package tested by bare `bun test`. */
const MONOREPO = {
	'package.json': manifest({
		packageManager: 'bun@1.3.14',
		workspaces: ['apps/*', 'packages/*'],
		scripts: { prepare: 'lefthook install', test: 'turbo run test', generate: 'turbo run generate' }
	}),
	'apps/docs/package.json': manifest({
		scripts: {
			prepare: "svelte-kit sync || echo ''",
			check: 'svelte-kit sync && svelte-check',
			test: 'bun run test:ci',
			'test:ci': 'vitest run --project unit --project ssr',
			'test:watch': 'vitest'
		},
		devDependencies: { '@sveltejs/kit': '^2', svelte: '^5', vitest: '^4' }
	}),
	'apps/docs/vitest.config.ts':
		"import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()], test: { setupFiles: ['tests/setup.ts'] } };\n",
	'apps/docs/svelte.config.js': 'export default {};\n',
	'apps/docs/src/lib/toast.svelte': '<p>toast</p>\n',
	'apps/docs/tests/unit/a.browser.test.ts': 'x',
	'apps/docs/tests/unit/sivir/toast.test.ts': 'a changed test',
	'apps/docs/tests/unit/sivir/z-small.test.ts': 'x',
	'packages/sivir/package.json': manifest({
		scripts: {
			'build:registry': 'bun scripts/build-registry.ts',
			test: 'bun run build:registry && bun test',
			dev: 'bun run --watch src/index.ts'
		},
		peerDependencies: { svelte: '^5', '@sveltejs/kit': '^2' }
	}),
	'packages/sivir/src/toast/lib.svelte.ts': 'let items = $state([]);\n',
	'packages/sivir/cli/registry.test.ts': 'small',
	'packages/sivir/src/toast/toast.svelte.test.ts': 'x',
	'changelog/0.3.6.md': 'notes'
};

test('each changed package gets its runner, transforms, generation commands and one-file smoke run', async () => {
	const changed = [
		'apps/docs/tests/unit/sivir/toast.test.ts',
		'packages/sivir/src/toast/lib.svelte.ts',
		'changelog/0.3.6.md'
	];

	expect(await buildProfiles(tree(MONOREPO), changed, 'bun')).toEqual([
		{
			dir: 'apps/docs',
			runtime: 'node',
			packageManager: 'bun',
			runner: 'vitest',
			transforms: [{ name: 'svelte', via: ['vitest'] }],
			generation: ['cd apps/docs && bun run prepare'],
			setupFiles: ['tests/setup.ts'],
			smoke: {
				file: 'apps/docs/tests/unit/sivir/toast.test.ts',
				command:
					'cd apps/docs && bunx vitest run --project unit --project ssr --reporter=dot --coverage.enabled=false tests/unit/sivir/toast.test.ts'
			}
		},
		{
			dir: 'packages/sivir',
			runtime: 'bun',
			packageManager: 'bun',
			runner: 'bun test',
			transforms: [{ name: 'svelte', via: [] }],
			generation: ['cd packages/sivir && bun run build:registry'],
			setupFiles: [],
			smoke: {
				file: 'packages/sivir/cli/registry.test.ts',
				command: 'cd packages/sivir && bun test cli/registry.test.ts'
			}
		}
	]);
});

test('hook installers and fan-out scripts are never generation commands', async () => {
	const [root] = await buildProfiles(tree({ ...MONOREPO, 'scripts/x.ts': 'x' }), ['scripts/x.ts'], null);

	expect(root).toMatchObject({ dir: '.', packageManager: 'bun', generation: [], runner: null });
});

test('a SvelteKit package gets `svelte-kit sync` when its tsconfig extends what sync writes', async () => {
	const [app] = await buildProfiles(
		tree({
			'package.json': manifest({
				scripts: { test: 'jest' },
				devDependencies: { '@sveltejs/kit': '^2', svelte: '^5', jest: '^29' }
			}),
			'tsconfig.json': '{ "extends": "./.svelte-kit/tsconfig.json" }',
			'jest.config.js':
				"module.exports = { setupFilesAfterEnv: ['./jest.setup.js'], transform: { svelte: 'svelte-jester' } };",
			'src/a.svelte': '<p></p>',
			'src/a.test.js': 'x'
		}),
		['src/a.svelte'],
		'pnpm'
	);

	expect(app).toMatchObject({
		runner: 'jest',
		transforms: [{ name: 'svelte', via: ['jest'] }],
		generation: ['pnpm exec svelte-kit sync'],
		setupFiles: ['./jest.setup.js'],
		smoke: { command: 'pnpm exec jest src/a.test.js' }
	});
});

test('a package declaring no framework needs no transform, whatever its files are named', async () => {
	const [pkg] = await buildProfiles(
		tree({ 'package.json': manifest({ scripts: { test: 'node --test' } }), 'a.svelte.js': 'x', 'a.test.js': 'x' }),
		['a.svelte.js'],
		'npm'
	);

	expect(pkg).toMatchObject({ runner: 'node --test', transforms: [], smoke: null });
});

test('the runner a step calls, past env assignments and exec prefixes', () => {
	expect(
		[
			'vitest run',
			'NODE_ENV=test bunx --bun vitest',
			'pnpm exec jest --ci',
			'npx ava',
			'bun test ./src',
			'node --import tsx --test',
			'bun run test',
			'tsc'
		].map(stepRunner)
	).toEqual(['vitest', 'vitest', 'jest', 'ava', 'bun test', 'node --test', null, null]);
});
