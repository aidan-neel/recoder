import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PrepOptions } from '../../../../src/review/pipeline/harness/package-prep';
import { execUnavailableReason, sandboxLayout } from '../../../../src/sandbox/exec-sandbox';
import { ExecWorkspace } from '../../../../src/sandbox/exec-workspace';
import { git } from '../../../helpers/git';

export const available = (await execUnavailableReason()) === null;

/** Temp work dirs `checkout` made, removed by `cleanupBases` from the importing test file's afterEach. */
const bases: string[] = [];

/** Removes every dir `checkout` made. */
export async function cleanupBases(): Promise<void> {
	for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
}

/** A package whose test imports `generated/value.js`, which only its `prepare` script writes; each run of it adds a line to `prep.log`. */
export const GENERATED = {
	'.gitignore': 'generated/\nprep.log\nnode_modules/\n',
	'package.json': JSON.stringify({
		name: 'generated',
		packageManager: 'bun@1.3.0',
		scripts: {
			prepare: "echo ran >> prep.log && mkdir -p generated && echo 'export const value = 42;' > generated/value.js",
			test: 'bun test'
		}
	}),
	'value.test.ts':
		"import { expect, test } from 'bun:test';\nimport { value } from './generated/value.js';\n\ntest('value', () => expect(value).toBe(42));\n"
};

/** A workspace whose changed package `a` needs no prep, beside the generated-file package as `b`, which prep never touches. */
export const UNPREPARED_SIBLING = {
	'package.json': JSON.stringify({ packageManager: 'bun@1.3.0', workspaces: ['packages/*'] }),
	'packages/a/package.json': JSON.stringify({ scripts: { test: 'bun test' } }),
	'packages/a/a.test.ts': "import { test } from 'bun:test';\n\ntest('a', () => {});\n",
	...Object.fromEntries(Object.entries(GENERATED).map(([path, content]) => [`packages/b/${path}`, content]))
};

/** A single-package repo whose one test always passes, so prep's smoke run succeeds. */
export const SIMPLE = {
	'package.json': JSON.stringify({ packageManager: 'bun@1.3.0', scripts: { test: 'bun test' } }),
	'a.test.ts': "import { expect, test } from 'bun:test';\n\ntest('a', () => expect(1).toBe(1));\n"
};

/** Svelte runes code with a test of it; the package's runner decides whether anything compiles the runes. */
export const RUNES = {
	'src/counter.svelte.ts':
		'export function counter() {\n\tlet count = $state(1);\n\n\treturn { get count() { return count; } };\n}\n',
	'src/counter.test.ts':
		"import { expect, test } from 'bun:test';\nimport { counter } from './counter.svelte.ts';\n\ntest('starts at 1', () => expect(counter().count).toBe(1));\n"
};

/**
 * A committed repo under a temp work dir, with `untracked` written after the
 * commit (installed tools), `head` committed on top of it as the change under
 * review, and the review's workspace on the last commit.
 */
export async function checkout(
	files: Record<string, string>,
	untracked: Record<string, string> = {},
	head: Record<string, string> = {}
): Promise<{ ws: ExecWorkspace; dir: string; baseSha: string }> {
	const base = await mkdtemp(join(import.meta.dir, '.prep-test-'));

	bases.push(base);

	const dir = join(base, 'work/repos/pr-1');

	for (const [path, content] of Object.entries({ ...files, ...untracked })) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}

	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['add', ...Object.keys(files)]);
	git(dir, ['commit', '-q', '-m', 'base']);

	for (const path of Object.keys(untracked)) await chmod(join(dir, path), 0o755);

	const baseSha = git(dir, ['rev-parse', 'HEAD']);

	if (Object.keys(head).length) {
		for (const [path, content] of Object.entries(head)) await writeFile(join(dir, path), content);

		git(dir, ['commit', '-q', '-am', 'head']);
	}

	const layout = sandboxLayout(dir, {
		home: join(base, 'home'),
		dataDir: join(base, 'data'),
		workDir: join(base, 'work')
	});

	return { ws: new ExecWorkspace(dir, git(dir, ['rev-parse', 'HEAD']), layout), dir, baseSha };
}

export function options(changed: string[], extra: Partial<PrepOptions> = {}): PrepOptions {
	return { changed, manager: 'bun', diffPaths: [], signal: new AbortController().signal, ...extra };
}

export async function prepRuns(dir: string): Promise<number> {
	return (await readFile(join(dir, 'prep.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
}
