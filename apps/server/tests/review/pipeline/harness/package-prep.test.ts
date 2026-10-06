import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { preparePackages, type PrepOptions } from '../../../../src/review/pipeline/harness/package-prep';
import { prepareSandbox } from '../../../../src/review/pipeline/harness/sandbox-setup';
import type { ReviewRun } from '../../../../src/review/pipeline/harness/context';
import { recordBaseline } from '../../../../src/review/pipeline/harness/verify-baseline';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { settleVerdict } from '../../../../src/review/pipeline/verify/settle';
import { execUnavailableReason, sandboxLayout } from '../../../../src/sandbox/exec-sandbox';
import { ExecWorkspace } from '../../../../src/sandbox/exec-workspace';
import { git } from '../../../helpers/git';

const available = (await execUnavailableReason()) === null;
const bases: string[] = [];

afterEach(async () => {
	delete process.env.RECODER_PACKAGE_PREP;
	for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
});

/** A package whose test imports `generated/value.js`, which only its `prepare` script writes; each run of it adds a line to `prep.log`. */
const GENERATED = {
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
const UNPREPARED_SIBLING = {
	'package.json': JSON.stringify({ packageManager: 'bun@1.3.0', workspaces: ['packages/*'] }),
	'packages/a/package.json': JSON.stringify({ scripts: { test: 'bun test' } }),
	'packages/a/a.test.ts': "import { test } from 'bun:test';\n\ntest('a', () => {});\n",
	...Object.fromEntries(Object.entries(GENERATED).map(([path, content]) => [`packages/b/${path}`, content]))
};

/** Svelte runes code with a test of it; the package's runner decides whether anything compiles the runes. */
const RUNES = {
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
async function checkout(
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

function options(changed: string[], extra: Partial<PrepOptions> = {}): PrepOptions {
	return { changed, manager: 'bun', diffPaths: [], signal: new AbortController().signal, ...extra };
}

async function prepRuns(dir: string): Promise<number> {
	return (await readFile(join(dir, 'prep.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
}

test.skipIf(!available)(
	'a test that imports a generated file runs after the prepare script that writes it',
	async () => {
		const { ws, dir } = await checkout(GENERATED);

		expect((await ws.run('bun test value.test.ts', 30_000)).exitCode).not.toBe(0);

		const report = await preparePackages(ws, options(['value.test.ts']));

		expect(report.profiles[0]).toMatchObject({
			dir: '.',
			runtime: 'bun',
			runner: 'bun test',
			generation: ['bun run prepare']
		});

		expect(report.steps.map((step) => [step.kind, step.command, step.exitCode, step.outcome])).toEqual([
			['generate', 'bun run prepare', 0, undefined],
			['smoke', 'bun test value.test.ts', 0, 'assertion-passed']
		]);

		expect(await prepRuns(dir)).toBe(1);
	}
);

test.skipIf(!available)('a second investigator on the same checkout reuses the preparation', async () => {
	const { ws, dir } = await checkout(GENERATED);
	const outcomes: string[] = [];
	const first = options(['value.test.ts'], { onOutcome: (outcome) => outcomes.push(outcome) });
	const [a, b] = await Promise.all([preparePackages(ws, first), preparePackages(ws, options(['value.test.ts']))]);
	const again = await preparePackages(ws, options(['value.test.ts']));
	const run = await ws.runInvestigation('bun test value.test.ts', 30_000, undefined, 'investigator-2');

	expect(b).toBe(a);
	expect(again).toBe(a);
	expect(run.outcome).toBe('assertion-passed');
	expect(outcomes).toEqual(['assertion-passed']);
	expect(await prepRuns(dir)).toBe(1);
});

test.skipIf(!available)('runes code under a runner that compiles them reaches its assertion', async () => {
	const vitest =
		'#!/bin/sh\ngrep -q vite-plugin-svelte vite.config.ts || exit 3\necho " ✓ src/counter.test.ts (1 test)"\n';

	const { ws } = await checkout(
		{
			...RUNES,
			'.gitignore': 'node_modules/\n',
			'package.json': JSON.stringify({
				scripts: { test: 'vitest run' },
				devDependencies: { svelte: '^5.0.0', vitest: '^3.0.0', '@sveltejs/vite-plugin-svelte': '^5.0.0' }
			}),
			'vite.config.ts':
				"import { svelte } from '@sveltejs/vite-plugin-svelte';\nexport default { plugins: [svelte()] };\n"
		},
		{ 'node_modules/.bin/vitest': vitest }
	);

	const report = await preparePackages(ws, options(['src/counter.svelte.ts']));

	expect(report.profiles[0]).toMatchObject({ runner: 'vitest', transforms: [{ name: 'svelte', via: ['vitest'] }] });
	expect(report.steps).toMatchObject([{ kind: 'smoke', exitCode: 0, outcome: 'assertion-passed' }]);
	expect(report.steps[0]!.command).toStartWith('bunx vitest run');

	const bare = await ws.runInvestigation('bun test src/counter.test.ts', 30_000, undefined, 'investigator');

	expect(bare.output).toContain('$state is not defined');
	expect(bare.outcome).toBe('unsupported-execution');
});

test.skipIf(!available)('runes code with no runner that compiles them is unsupported execution', async () => {
	const { ws } = await checkout({
		...RUNES,
		'package.json': JSON.stringify({ scripts: { test: 'bun test' }, peerDependencies: { svelte: '^5.0.0' } })
	});

	const report = await preparePackages(ws, options(['src/counter.svelte.ts']));

	expect(report.profiles[0]).toMatchObject({ runner: 'bun test', transforms: [{ name: 'svelte', via: [] }] });

	expect(report.steps).toMatchObject([
		{ kind: 'smoke', command: 'bun test src/counter.test.ts', outcome: 'unsupported-execution' }
	]);
});

test.skipIf(!available)('a bare runtime on rune-free code in a runes package reaches the bug', async () => {
	const { ws } = await checkout({
		'package.json': JSON.stringify({ scripts: { test: 'bun test' }, peerDependencies: { svelte: '^5.0.0' } }),
		'src/util.svelte.ts': 'export function double(n: number): number {\n\treturn n * 3;\n}\n'
	});

	await preparePackages(ws, options(['src/util.svelte.ts']));

	const evidence = new EvidenceStore(null, buildInventory(''), 20_000);

	evidence.exec = ws;

	const [result] = await evidence.executeRound(
		[{ action: 'run', command: `bun -e "import { double } from './src/util.svelte.ts'; console.log(double(1))"` }],
		undefined,
		undefined,
		1,
		'verifier-1'
	);

	expect(result).toMatchObject({ exitCode: 0, outcome: 'assertion-passed' });

	const [failing] = await evidence.executeRound(
		[
			{
				action: 'run',
				command: `bun -e "import { double } from './src/util.svelte.ts'; if (double(1) !== 2) { console.error('expected 2, got ' + double(1)); process.exit(1); }"`
			}
		],
		undefined,
		undefined,
		1,
		'verifier-1'
	);

	expect(failing).toMatchObject({ exitCode: 1, outcome: 'assertion-failed' });

	expect(
		settleVerdict(
			{ evidenceIds: [failing!.evidenceId!], reason: 'double(1) returns 3: `expected 2, got 3`', verdict: 'confirmed' },
			evidence,
			'verifier-1'
		)
	).toMatchObject({ outcome: 'reproduced' });
});

test.skipIf(!available)(
	'a proof whose base rerun stops in setup on the unprepared base tree keeps its proof',
	async () => {
		const { ws, baseSha } = await checkout(
			{
				...GENERATED,
				'src/cap.ts': 'export const cap = (n: number) => Math.min(n, 3);\n',
				'value.test.ts':
					"import { expect, test } from 'bun:test';\nimport { value } from './generated/value.js';\nimport { cap } from './src/cap.ts';\n\ntest('cap', () => {\n\texpect(value).toBe(42);\n\texpect(cap(5)).toBe(3);\n});\n"
			},
			{},
			{ 'src/cap.ts': 'export const cap = (n: number) => Math.min(n, 4);\n' }
		);

		await preparePackages(ws, options(['src/cap.ts']));

		const evidence = new EvidenceStore(null, buildInventory(''), 20_000);

		evidence.exec = ws;

		const [proof] = await evidence.executeRound(
			[{ action: 'run', command: 'bun test value.test.ts' }],
			undefined,
			undefined,
			1,
			'verifier-1'
		);

		expect(proof).toMatchObject({ exitCode: 1, outcome: 'assertion-failed' });

		const verified = settleVerdict(
			{ evidenceIds: [proof!.evidenceId!], reason: 'cap(5) returns 4, past the limit of 3.', verdict: 'confirmed' },
			evidence,
			'verifier-1'
		);

		if (verified === 'refuted') throw new Error('the head run should prove the finding');

		const signal = new AbortController().signal;

		const context = {
			evidence,
			workspace: ws,
			mergeBaseSha: baseSha,
			deadlineAt: () => Date.now() + 120_000,
			signal,
			changes: () => ({ added: [], removed: [], symbols: [] })
		};

		const baselined = await recordBaseline(verified, context, 'verifier-1');

		expect(baselined).toMatchObject({ outcome: 'reproduced', reason: verified.reason });

		expect(baselined.evidence?.baseline).toMatchObject({
			unavailable: 'the command could not run on the base commit',
			result: 'environment'
		});
	}
);

test.skipIf(!available)('a run that stops in setup is unresolved: neither proof nor disproof', async () => {
	const { ws } = await checkout({
		...GENERATED,
		'package.json': JSON.stringify({ packageManager: 'bun@1.3.0', scripts: { prepare: 'exit 1', test: 'bun test' } })
	});

	await preparePackages(ws, options(['value.test.ts']));

	const evidence = new EvidenceStore(null, buildInventory(''), 20_000);

	evidence.exec = ws;

	const [result] = await evidence.executeRound(
		[{ action: 'run', command: 'bun test value.test.ts' }],
		undefined,
		undefined,
		1,
		'verifier-1'
	);

	expect(result!.outcome).toBe('setup-failed');
	expect(evidence.get(result!.evidenceId!)?.outcome).toBe('setup-failed');

	const cite = { evidenceIds: [result!.evidenceId!], reason: 'The run printed `generated/value.js` missing.' };

	expect(settleVerdict({ ...cite, verdict: 'confirmed' }, evidence, 'verifier-1')).toMatchObject({
		status: 'unverified',
		outcome: 'inconclusive'
	});

	expect(settleVerdict({ ...cite, verdict: 'refuted' }, evidence, 'verifier-1')).not.toBe('refuted');
});

test.skipIf(!available)('a run that stops in setup in an unprepared package is repaired, then rerun', async () => {
	const { ws, dir } = await checkout(UNPREPARED_SIBLING);

	const repaired: boolean[] = [];

	await preparePackages(ws, options(['packages/a/a.test.ts'], { onOutcome: (_, flag) => repaired.push(flag) }));

	const run = await ws.runInvestigation('cd packages/b && bun test value.test.ts', 30_000, undefined, 'investigator');

	expect(run.outcome).toBe('assertion-passed');
	expect(run.output).toStartWith('[Setup repaired: ran `cd packages/b && bun run prepare`, then reran the command]');
	expect(repaired).toEqual([true]);
	expect(await prepRuns(join(dir, 'packages/b'))).toBe(1);
});

test.skipIf(!available)('a setup repair takes its time from the prep budget: with none left, none runs', async () => {
	const { ws, dir } = await checkout(UNPREPARED_SIBLING);

	const run = ws.run.bind(ws);

	ws.run = async (...args) => ({ ...(await run(...args)), elapsedMs: 240_000 });

	const report = await preparePackages(ws, options(['packages/a/a.test.ts']));

	ws.run = run;

	expect(report.steps).toMatchObject([{ kind: 'smoke', exitCode: 0 }]);

	const stopped = await ws.runInvestigation(
		'cd packages/b && bun test value.test.ts',
		30_000,
		undefined,
		'investigator'
	);

	expect(stopped.outcome).toBe('setup-failed');
	expect(await prepRuns(join(dir, 'packages/b'))).toBe(0);
});

test.skipIf(!available)('cancelling during a prerequisite stops it and runs nothing after', async () => {
	const { ws, dir } = await checkout({
		...GENERATED,
		'package.json': JSON.stringify({
			scripts: { prepare: 'echo started >> prep.log && sleep 30 && echo finished >> prep.log', test: 'bun test' }
		})
	});

	const controller = new AbortController();
	const started = Date.now();

	const report = await preparePackages(
		ws,
		options(['value.test.ts'], {
			signal: controller.signal,
			onStep: (_, result) => result || setTimeout(() => controller.abort(), 1_000)
		})
	);

	expect(report.cancelled).toBe(true);
	expect(report.steps.map((step) => step.kind)).toEqual(['generate']);
	expect(Date.now() - started).toBeLessThan(15_000);
	expect(await readFile(join(dir, 'prep.log'), 'utf8')).toBe('started\n');
	expect(ws.settleRun).toBeNull();
});

/**
 * `prepareSandbox` on `files` (the generated-file package by default), as a
 * review whose run holds only what it reads, with every task row it writes,
 * after its checks finish.
 */
async function harnessOn(
	files: Record<string, string> = GENERATED
): Promise<{ ws: ExecWorkspace; dir: string; run: ReviewRun; tasks: string[] }> {
	const { ws, dir } = await checkout(files);
	const tasks: string[] = [];

	const run = {
		workspace: ws,
		assignments: [],
		units: [{ scope: [{ path: 'value.test.ts' }] }],
		controller: new AbortController(),
		task: (id: string, _label: string, status: string) => tasks.push(`${id}:${status}`),
		evidence: new EvidenceStore(null, buildInventory(''), 20_000),
		inventory: buildInventory(''),
		input: {},
		deadlineAt: Date.now() + 600_000,
		investigationDeadline: Date.now() + 600_000
	} as unknown as ReviewRun;

	await (
		await prepareSandbox(run, { report: Promise.resolve(null), wait: { waitedMs: 0 } })
	)();

	return { ws, dir, run, tasks };
}

test.skipIf(!available)('the harness prepares changed packages before investigators, and tells them how', async () => {
	const { ws, dir, run, tasks } = await harnessOn();

	expect(await prepRuns(dir)).toBe(1);
	expect(tasks).toContain('prepare:done');
	expect(run.setupNotes).toContain('one test file: `bun test <file>`');
	expect(ws.settleRun).not.toBeNull();
	expect(ws.preparedWith).toBe('package prep: bun run prepare');
});

test.skipIf(!available)('a generation command that failed does not mark the checkout prepared', async () => {
	const { ws, tasks } = await harnessOn({
		...GENERATED,
		'package.json': JSON.stringify({ scripts: { prepare: 'echo ran >> prep.log && exit 1', test: 'bun test' } })
	});

	expect(tasks).toContain('prepare:partial');
	expect(ws.preparedWith).toBe('');
});

test.skipIf(!available)('with RECODER_PACKAGE_PREP=0 no prerequisite runs', async () => {
	process.env.RECODER_PACKAGE_PREP = '0';

	const { ws, dir, run, tasks } = await harnessOn();

	expect(await prepRuns(dir)).toBe(0);
	expect(tasks.filter((task) => /^(?:prepare|outcomes):/.test(task))).toEqual([]);
	expect(run.setupNotes).not.toContain('Changed packages');
	expect(ws.settleRun).toBeNull();
	expect(ws.preparedWith).toBe('');

	expect(
		(await ws.runInvestigation('bun test value.test.ts', 30_000, undefined, 'investigator')).outcome
	).toBeUndefined();
});
