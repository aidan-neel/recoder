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

/** A Svelte monorepo: a SvelteKit app tested by vitest, and a component package whose tests run after a registry build, under bare `bun test`. */
const MONOREPO = {
	'package.json': manifest({
		packageManager: 'bun@1.3.14',
		workspaces: ['apps/*', 'packages/*'],
		scripts: { prepare: 'husky', test: 'nx run-many -t test', generate: 'nx run-many -t generate' }
	}),
	'apps/site/package.json': manifest({
		scripts: {
			prepare: 'svelte-kit sync',
			check: 'svelte-kit sync && svelte-check',
			test: 'bun run test:unit',
			'test:unit': 'vitest run --project server',
			'test:watch': 'vitest'
		},
		devDependencies: { '@sveltejs/kit': '^2', svelte: '^5', vitest: '^4' }
	}),
	'apps/site/vitest.config.ts':
		"import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()], test: { setupFiles: ['test/setup.ts'] } };\n",
	'apps/site/svelte.config.js': 'export default {};\n',
	'apps/site/src/lib/Banner.svelte': '<p>banner</p>\n',
	'apps/site/test/a.browser.test.ts': 'x',
	'apps/site/test/unit/banner.test.ts': 'a changed test',
	'apps/site/test/unit/z-small.test.ts': 'x',
	'packages/widgets/package.json': manifest({
		scripts: {
			'build:registry': 'node tools/registry.js',
			test: 'bun run build:registry && bun test',
			dev: 'bun --watch src/index.ts'
		},
		peerDependencies: { svelte: '^5', '@sveltejs/kit': '^2' }
	}),
	'packages/widgets/src/menu/state.svelte.ts': 'let open = $state(false);\n',
	'packages/widgets/tools/registry.test.ts': 'small',
	'packages/widgets/src/menu/menu.svelte.test.ts': 'x',
	'notes/release.md': 'notes'
};

test('each changed package gets its runner, transforms, generation commands and one-file smoke run', async () => {
	const changed = [
		'apps/site/test/unit/banner.test.ts',
		'packages/widgets/src/menu/state.svelte.ts',
		'notes/release.md'
	];

	expect(await buildProfiles(tree(MONOREPO), changed, 'bun')).toEqual([
		{
			dir: 'apps/site',
			runtime: 'node',
			packageManager: 'bun',
			runner: 'vitest',
			transforms: [{ name: 'svelte', via: ['vitest'] }],
			generation: ['cd apps/site && bun run prepare'],
			setupFiles: ['test/setup.ts'],
			smoke: {
				file: 'apps/site/test/unit/banner.test.ts',
				command:
					'cd apps/site && bunx vitest run --project server --reporter=dot --coverage.enabled=false test/unit/banner.test.ts'
			}
		},
		{
			dir: 'packages/widgets',
			runtime: 'bun',
			packageManager: 'bun',
			runner: 'bun test',
			transforms: [{ name: 'svelte', via: [] }],
			generation: ['cd packages/widgets && bun run build:registry'],
			setupFiles: [],
			smoke: {
				file: 'packages/widgets/tools/registry.test.ts',
				command: 'cd packages/widgets && bun test tools/registry.test.ts'
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
