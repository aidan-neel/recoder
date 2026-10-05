import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execUnavailableReason } from '../../src/sandbox/exec-sandbox';
import { overlayUnavailableReason, removeOverlayDirs } from '../../src/sandbox/overlay';
import { sharedInstallFixture, type SharedInstallFixture } from '../helpers/shared-install';

const available = (await execUnavailableReason()) === null;
const overlay = process.platform === 'linux' && (await overlayUnavailableReason()) === null;
const modes = process.platform === 'darwin' ? ['clone'] : overlay ? ['overlay', 'copy'] : ['copy'];
const fixtures: SharedInstallFixture[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await removeOverlayDirs(fixture.base);
});

afterAll(() => {
	delete process.env.RECODER_OVERLAY;
});

async function fixture(...args: Parameters<typeof sharedInstallFixture>): Promise<SharedInstallFixture> {
	const made = await sharedInstallFixture(...args);

	fixtures.push(made);

	return made;
}

/** A repo whose first two reviews have installed, with a third review still to start. */
async function afterTwoReviews() {
	const fx = await fixture();
	const [one, two, three] = [await fx.review('r1'), await fx.review('r2'), await fx.review('r3')];

	await one.workspace.setup();
	await two.workspace.setup();

	return { fx, two, three };
}

/** The one install a repo has published: its directory holds `tree/` and `ready.json`. */
async function published(sharedDir: string): Promise<string> {
	const root = join(sharedDir, 'installs', 'acme__app');
	const keys = await readdir(root);

	expect(keys.filter((key) => !key.includes('.tmp-'))).toHaveLength(1);

	return join(
		root,
		keys.find((key) => !key.includes('.tmp-'))!
	);
}

for (const mode of modes) {
	describe.skipIf(!available)(`shared install (${mode})`, () => {
		beforeEach(() => {
			process.env.RECODER_OVERLAY = mode === 'overlay' ? 'on' : 'off';
		});

		test('the first review installs once and later reviews of the same lockfile skip the install', async () => {
			const fx = await fixture();
			const first = await fx.review('r1');
			const second = await fx.review('r2');

			const one = await first.workspace.setup();
			const two = await second.workspace.setup();

			expect(one.steps.map((step) => [step.exitCode, step.reused ?? false])).toEqual([[0, false]]);
			expect(two.steps.map((step) => [step.exitCode, step.reused ?? false])).toEqual([[0, true]]);
			expect(two.steps[0]!.command).toBe(one.steps[0]!.command);
			expect((await second.workspace.run('cat node_modules/pkg/index.js', 10_000)).output).toBe('v1\n');
		}, 30_000);

		test('a sandboxed command cannot change the shared install, and the next review still sees it untouched', async () => {
			const { fx, two, three } = await afterTwoReviews();
			const entry = await published(fx.sharedDir);
			const real = join(entry, 'tree/node_modules/pkg');

			await two.workspace.run(
				`echo evil > node_modules/pkg/new.js; echo evil >> node_modules/pkg/index.js; rm node_modules/pkg/postinstall.sh; echo evil > ${real}/index.js; echo evil > ${real}/new.js`,
				10_000
			);

			expect(await readFile(join(real, 'index.js'), 'utf8')).toBe('v1\n');
			expect(existsSync(join(real, 'new.js'))).toBe(false);
			expect(existsSync(join(real, 'postinstall.sh'))).toBe(true);

			await three.workspace.setup();

			const seen = await three.workspace.run('cat node_modules/pkg/index.js; ls node_modules/pkg', 10_000);

			expect(seen.output).toBe('v1\nindex.js\npostinstall.sh\n');
		}, 30_000);

		test('a sandboxed command cannot change the shared package store, and the next review still sees it untouched', async () => {
			const { fx, two, three } = await afterTwoReviews();
			const store = '"$BUN_INSTALL_CACHE_DIR"';

			await two.workspace.run(
				`echo evil >> ${store}/pkg@1.0.0/index.js; echo evil > ${store}/new; rm ${store}/pkg@1.0.0/index.js`,
				10_000
			);

			const shared = join(fx.sharedDir, 'stores', 'acme__app', 'current', 'bun');

			expect(await readFile(join(shared, 'pkg@1.0.0/index.js'), 'utf8')).toBe('tarball\n');
			expect(existsSync(join(shared, 'new'))).toBe(false);

			await three.workspace.setup();

			const seen = await three.workspace.run(`cat ${store}/pkg@1.0.0/index.js; ls ${store}`, 10_000);

			expect(seen.output).toBe('tarball\npkg@1.0.0\n');
		}, 30_000);

		test('the install step leaves lifecycle scripts off', async () => {
			const fx = await fixture();
			const { workspace } = await fx.review('r1');

			await workspace.setup();

			const seen = await workspace.run('ls node_modules', 10_000);

			expect(seen.output).not.toContain('POSTINSTALL_RAN');
		}, 30_000);

		test('a different lockfile installs again under its own key', async () => {
			const fx = await fixture();
			const first = await fx.review('r1');

			const second = await fx.review('r2', async (checkout) => {
				await Bun.write(join(checkout, 'bun.lock'), '{"changed":true}\n');
			});

			await first.workspace.setup();

			const report = await second.workspace.setup();

			expect(report.steps.map((step) => step.reused ?? false)).toEqual([false]);
			expect(await readdir(join(fx.sharedDir, 'installs', 'acme__app'))).toHaveLength(2);
		}, 30_000);

		test('an install run on manifests the PR changed adds nothing to the shared package store', async () => {
			const fx = await fixture();
			const trusted = await fx.review('r1');

			await trusted.workspace.setup();

			const changed = await fx.review('r2', async (checkout) => {
				await Bun.write(join(checkout, 'bun.lock'), '{"changed":true}\n');
				await Bun.write(join(checkout, 'evil.marker'), '');
			});

			await changed.workspace.setup();

			const later = await fx.review('r3');

			await later.workspace.setup();

			const seen = await later.workspace.run('ls "$BUN_INSTALL_CACHE_DIR"', 10_000);

			expect(seen.output).toBe('pkg@1.0.0\n');
		}, 30_000);

		test('two first reviews started together publish one install and both can use it', async () => {
			const fx = await fixture();
			const [one, two] = [await fx.review('r1'), await fx.review('r2')];

			await Promise.all([one.workspace.setup(), two.workspace.setup()]);
			await published(fx.sharedDir);

			for (const { workspace } of [one, two]) {
				expect((await workspace.run('cat node_modules/pkg/index.js', 10_000)).output).toBe('v1\n');
			}
		}, 30_000);
	});
}

describe.skipIf(!available)('shared install, inputs that run code', () => {
	test('a repo whose Yarn config runs its own release installs for every review instead of sharing', async () => {
		const fx = await fixture(
			{
				'yarn.lock': '# lock\n',
				'package.json': '{"name":"app"}\n',
				'.yarnrc.yml': 'yarnPath: .yarn/releases/yarn.cjs\n'
			},
			'yarn'
		);

		const first = await fx.review('r1');
		const second = await fx.review('r2');

		await first.workspace.setup();

		const report = await second.workspace.setup();

		expect(report.steps.map((step) => [step.exitCode, step.reused ?? false])).toEqual([[0, false]]);
		expect(existsSync(join(fx.sharedDir, 'installs'))).toBe(false);
	}, 30_000);
});

describe.skipIf(!available || !overlay)('shared install, overlay', () => {
	test('commands run as the same user with and without the overlay', async () => {
		process.env.RECODER_OVERLAY = 'on';

		const fx = await fixture();
		const { workspace } = await fx.review('r1');

		await workspace.setup();

		const seen = await workspace.run('id -u; touch node_modules/owned && stat -c %u node_modules/owned', 10_000);

		expect(seen.output).toBe(`${process.getuid!()}\n${process.getuid!()}\n`);
	}, 30_000);
});
