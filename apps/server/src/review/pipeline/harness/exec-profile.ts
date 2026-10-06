import { posix } from 'node:path';
import { packageManifests, type CommitTree } from '../../../sandbox/exec-workspace.js';
import { EXEC, singleFileCommands, testChain } from '../mutation/test-run.js';
import { CODE_FILE, owningDir, PLAIN_DIR } from './baseline-checks.js';

/** The test runners a profile can name. */
export type TestRunner = 'vitest' | 'jest' | 'ava' | 'bun test' | 'node --test';

export type PackageManager = keyof typeof EXEC;

/** A compiler step some of a package's code needs before anything can run it. */
export interface Transform {
	name: keyof typeof TRANSFORMS;
	/** The runners whose config supplies it; `bun` or `node` run on their own never do. */
	via: TestRunner[];
}

/**
 * How one package's tests run, read from its scripts, workspace and test
 * config rather than from file extensions: where to run, with what, which
 * code needs compiling first, and which commands write the files its tests
 * import. Bounded: a few generation commands and one smoke run.
 */
export interface ExecutionProfile {
	dir: string;
	runtime: 'node' | 'bun';
	packageManager: PackageManager;
	runner: TestRunner | null;
	transforms: Transform[];
	/** Commands that write files the tests import, in the order they run. */
	generation: string[];
	/** Setup and global setup files the test config names; the smoke run executes them. */
	setupFiles: string[];
	/** The runner on one existing test file, which proves the runner executes here. */
	smoke: { file: string; command: string } | null;
}

/** Changed packages past this many get no profile, so the prerequisite check stays small. */
const MAX_PROFILES = 4;

/** Generation commands past this many per package are left out. */
const MAX_GENERATION = 3;

/** Setup files listed past this many are left out. */
const MAX_SETUP_FILES = 5;

/** Config files bigger than this are not read. */
const MAX_CONFIG_BYTES = 64_000;

/** Scripts that may write files a package's tests import, in the order they run. */
const GENERATION_SCRIPTS = ['pretest', 'prepare', 'generate', 'sync', 'build:registry'];

/** Steps before a test runner that only check or format, so they write nothing a test imports. */
const CHECK_STEP = /^(?:lint|check|typecheck|types|format|test)(?::|$)/;

/** Scripts that install git hooks, fan out to other packages or never exit: none prepares this package's tests. */
const NOT_PREPARATION =
	/\b(?:husky|lefthook|simple-git-hooks|turbo|nx|lerna)\b|core\.hooksPath|--filter\b|--recursive\b|\s-r\b|--workspaces?\b|--watch\b|\bwatch\b|\bdev\b/;

/** Each runner a script step can call, by the command it starts with. */
const RUNNER_STEPS: Array<[RegExp, TestRunner]> = [
	[/^(?:vitest|vp test)\b/, 'vitest'],
	[/^jest\b/, 'jest'],
	[/^ava\b/, 'ava'],
	[/^bun test\b/, 'bun test'],
	[/^node\b.*\s--test\b/, 'node --test']
];

/**
 * The compiler transforms a profile knows: the files that need one, the
 * dependency that marks a package as using it, and what in a vitest or vite
 * config, a jest config, or a bun preload supplies it.
 */
const TRANSFORMS = {
	svelte: {
		file: /\.svelte(?:\.[cm]?[jt]s)?$/,
		dependency: 'svelte',
		vitest: /@sveltejs\/(?:kit\/vite|vite-plugin-svelte)/,
		jest: /svelte-jester|jest-transform-svelte/,
		bun: /svelte/i
	},
	vue: {
		file: /\.vue$/,
		dependency: 'vue',
		vitest: /@vitejs\/plugin-vue/,
		jest: /vue-jest|@vue\/vue3-jest/,
		bun: /vue/i
	}
};

/** A vitest config importing the package's vite config to merge it, so the vite config's plugins apply to tests too. */
const IMPORTS_VITE_CONFIG = /from\s+['"]\.\/vite\.config(?:\.[cm]?[jt]s)?['"]/;

/** Test files a smoke run should pass over when another exists: browser and end-to-end suites, and runes modules. */
const HEAVY_TEST = /browser|e2e|playwright|\.svelte\./i;

type Manifest = Record<string, unknown>;

/** A command step without leading env assignments and a package manager's exec prefix. */
export function bareStep(step: string): string {
	return step
		.trim()
		.replace(/^(?:\w+=\S*\s+)*/, '')
		.replace(/^(?:bunx|npx|pnpm(?:\s+exec)?|yarn)\s+(?:--bun\s+)?/, '');
}

/** The test runner a command step calls, or null when it calls none. */
export function stepRunner(step: string): TestRunner | null {
	const bare = bareStep(step);

	return RUNNER_STEPS.find(([pattern]) => pattern.test(bare))?.[1] ?? null;
}

/** The package dirs of the commit, `.` for the root, from the manifests worth reading. */
export function packageDirs(tree: CommitTree): string[] {
	return packageManifests(tree.sizes.keys()).map((path) =>
		path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length)
	);
}

/** `command`, run from `dir`. */
function inDir(dir: string, command: string): string {
	return dir === '.' ? command : `cd ${dir} && ${command}`;
}

async function readText(tree: CommitTree, path: string | undefined): Promise<string> {
	if (!path || (tree.sizes.get(path) ?? Infinity) > MAX_CONFIG_BYTES) return '';

	return (await tree.read(path)) ?? '';
}

async function readManifest(tree: CommitTree, path: string): Promise<Manifest | null> {
	try {
		const parsed: unknown = JSON.parse(await readText(tree, path));

		return parsed && typeof parsed === 'object' ? (parsed as Manifest) : null;
	} catch {
		return null;
	}
}

function scriptsOf(manifest: Manifest): Map<string, string> {
	const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};

	return new Map(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function dependenciesOf(manifest: Manifest | null): string[] {
	return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => {
		const deps = manifest?.[field];

		return deps && typeof deps === 'object' ? Object.keys(deps) : [];
	});
}

/**
 * The package's own config files, by kind, read from the commit. Tests see
 * the vitest config, plus the vite config when there is no vitest config or
 * the vitest config imports it to merge.
 */
async function readConfigs(tree: CommitTree, dir: string, files: string[], manifest: Manifest) {
	const own = (pattern: RegExp) =>
		files.find((path) => posix.dirname(path) === dir && pattern.test(posix.basename(path)));

	const vitestConfig = own(/^vitest\.(?:config|workspace)\.[cm]?[jt]s$/);
	const vitest = await readText(tree, vitestConfig);
	const viteConfig = own(/^vite\.config\.[cm]?[jt]s$/);
	const jestConfig = own(/^jest\.config\.(?:[cm]?[jt]s|json)$/);
	const bunfigPath = own(/^bunfig\.toml$/) ?? (tree.sizes.has('bunfig.toml') ? 'bunfig.toml' : undefined);
	const bunfig = await readText(tree, bunfigPath);
	const preloads = [...(/^\s*preload\s*=\s*(\[[^\]]*\]|"[^"]*")/m.exec(bunfig)?.[1] ?? '').matchAll(/"([^"]+)"/g)];
	const preloadPaths = preloads.map((match) => posix.join(posix.dirname(bunfigPath ?? '.'), match[1]!));

	return {
		hasVitestConfig: vitestConfig !== undefined,
		vite: vitestConfig && !IMPORTS_VITE_CONFIG.test(vitest) ? vitest : `${vitest}\n${await readText(tree, viteConfig)}`,
		hasJest: jestConfig !== undefined || manifest.jest !== undefined,
		jest: (await readText(tree, jestConfig)) + (manifest.jest ? JSON.stringify(manifest.jest) : ''),
		ava: Boolean(own(/^ava\.config\.[cm]?js$/) || manifest.ava),
		svelte: Boolean(own(/^svelte\.config\.[cm]?[jt]s$/)),
		tsconfig: await readText(tree, own(/^tsconfig\.json$/)),
		preload: (await Promise.all(preloadPaths.map((path) => readText(tree, path)))).join('\n')
	};
}

type Configs = Awaited<ReturnType<typeof readConfigs>>;

/** The runner the test script calls, else the one the package's config or dependencies point to. */
function pickRunner(step: string, configs: Configs, dependencies: Set<string>): TestRunner | null {
	const named = stepRunner(step);

	if (named) return named;
	if (configs.hasVitestConfig || /\btest\s*:/.test(configs.vite)) return 'vitest';
	if (configs.hasJest) return 'jest';
	if (configs.ava) return 'ava';

	return (['vitest', 'jest', 'ava'] as const).find((runner) => dependencies.has(runner)) ?? null;
}

/** The transforms the package's code needs, each with the runners that supply it here. */
function pickTransforms(files: string[], configs: Configs, dependencies: Set<string>): Transform[] {
	return (Object.keys(TRANSFORMS) as Transform['name'][]).flatMap((name) => {
		const spec = TRANSFORMS[name];
		const declared = dependencies.has(spec.dependency) || (name === 'svelte' && configs.svelte);

		if (!declared || !files.some((path) => spec.file.test(path))) return [];

		const via: TestRunner[] = [];

		if (spec.vitest.test(configs.vite)) via.push('vitest');
		if (spec.jest.test(configs.jest)) via.push('jest');
		if (spec.bun.test(configs.preload)) via.push('bun test');

		return [{ name, via }];
	});
}

/**
 * Commands that write what the tests import: the scripts the test script runs
 * before its runner, then the usual generation scripts, then `svelte-kit sync`
 * for a SvelteKit package whose tsconfig extends what it writes, or whose
 * scripts run it only inside another step. Hooks, fan-out and watch scripts
 * are left out.
 */
function pickGeneration(
	dir: string,
	scripts: Map<string, string>,
	before: string[],
	configs: Configs,
	dependencies: Set<string>,
	manager: PackageManager
): string[] {
	const names = [...new Set([...before.filter((name) => !CHECK_STEP.test(name)), ...GENERATION_SCRIPTS])].filter(
		(name) => scripts.has(name) && !NOT_PREPARATION.test(scripts.get(name)!)
	);

	const commands = names.map((name) => inDir(dir, `${manager} run ${name}`));
	const synced = names.some((name) => scripts.get(name)!.includes('svelte-kit sync'));
	const usesSync = [...scripts.values()].some((script) => script.includes('svelte-kit sync'));

	if (
		dependencies.has('@sveltejs/kit') &&
		!synced &&
		(usesSync || /\.svelte-kit\/tsconfig\.json/.test(configs.tsconfig))
	)
		commands.push(inDir(dir, `${EXEC[manager]} svelte-kit sync`));

	return commands.slice(0, MAX_GENERATION);
}

/** The setup and global setup files a vitest or jest config names. */
function setupFilesOf(configs: Configs): string[] {
	const lists = [
		...`${configs.vite}\n${configs.jest}`.matchAll(
			/\b(?:setupFiles|setupFilesAfterEnv|globalSetup)["']?\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g
		)
	];

	const files = lists.flatMap((list) => [...list[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!));

	return [...new Set(files)].slice(0, MAX_SETUP_FILES);
}

/**
 * The runner on one test file of the package, through the test script's own
 * runner step so its flags hold: a test the PR touched first, then the
 * smallest, passing over browser and runes suites while another exists.
 */
function pickSmoke(
	dir: string,
	files: string[],
	scripts: Map<string, string>,
	manager: PackageManager,
	tree: CommitTree,
	changed: Set<string>
): ExecutionProfile['smoke'] {
	const single = singleFileCommands(
		[...scripts].map(([name, command]) => `${dir}: ${name} → ${command}`),
		[`${manager} run test`]
	);

	const rank = (path: string) =>
		(HEAVY_TEST.test(path) ? 2e9 : 0) + (changed.has(path) ? 0 : 1e9) + Math.min(tree.sizes.get(path) ?? 0, 1e9 - 1);

	const candidates = files
		.filter((path) => CODE_FILE.test(path))
		.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

	for (const file of candidates) {
		const command = single(file);

		if (command) return { file, command };
	}

	return null;
}

/** The profile of the package at `dir`, or null when its manifest cannot be read. */
export async function packageProfile(
	tree: CommitTree,
	dirs: string[],
	dir: string,
	manager: PackageManager | null,
	changed: string[]
): Promise<ExecutionProfile | null> {
	const manifest = await readManifest(tree, posix.join(dir, 'package.json'));

	if (!manifest) return null;

	const root = dir === '.' ? manifest : await readManifest(tree, 'package.json');
	const workspaceRoot = Boolean(root?.workspaces) || tree.sizes.has('pnpm-workspace.yaml');
	const dependencies = new Set([...dependenciesOf(manifest), ...(workspaceRoot ? dependenciesOf(root) : [])]);
	const declared = /^(bun|pnpm|yarn|npm)@/.exec(String(root?.packageManager ?? ''))?.[1] as PackageManager | undefined;
	const tool = manager ?? declared ?? 'npm';
	const files = [...tree.sizes.keys()].filter((path) => owningDir(path, dirs) === dir);
	const scripts = scriptsOf(manifest);
	const chain = testChain(scripts);
	const configs = await readConfigs(tree, dir, files, manifest);
	const runner = pickRunner(chain.runner, configs, dependencies);

	return {
		dir,
		runtime: runner === 'bun test' || /^bun\s|--bun\b/.test(chain.runner) ? 'bun' : 'node',
		packageManager: tool,
		runner,
		transforms: pickTransforms(files, configs, dependencies),
		generation: pickGeneration(dir, scripts, chain.before, configs, dependencies, tool),
		setupFiles: setupFilesOf(configs),
		smoke: pickSmoke(dir, files, scripts, tool, tree, new Set(changed))
	};
}

/**
 * The profiles of the packages that own a changed code file, in path order,
 * at most `MAX_PROFILES`. Only dirs safe to put in a command unquoted count.
 */
export async function buildProfiles(
	tree: CommitTree,
	changed: string[],
	manager: PackageManager | null
): Promise<ExecutionProfile[]> {
	const dirs = packageDirs(tree);

	const owners = new Set(changed.filter((path) => CODE_FILE.test(path)).flatMap((path) => owningDir(path, dirs) ?? []));

	const picked = [...owners]
		.filter((dir) => dir === '.' || PLAIN_DIR.test(dir))
		.sort()
		.slice(0, MAX_PROFILES);

	const profiles = await Promise.all(picked.map((dir) => packageProfile(tree, dirs, dir, manager, changed)));

	return profiles.filter((profile) => profile !== null);
}
