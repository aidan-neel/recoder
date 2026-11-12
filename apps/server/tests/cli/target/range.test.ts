import { afterAll, expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { resolveTarget } from '../../../src/cli/target/resolve-target';
import { git } from '../../helpers/git';
import { checkoutsOf, commitAll, removeFixtureFolders, targetRequest, userRepository, writeFiles } from './fixture';

afterAll(removeFixtureFolders);

/** A repository where `feature` changed `a.ts` and `main` later gained `base-only.ts`. */
async function divergedRepository(): Promise<{ dir: string; forkPoint: string; mainTip: string }> {
	const dir = await userRepository();
	const forkPoint = git(dir, ['rev-parse', 'HEAD']);

	git(dir, ['checkout', '-b', 'feature']);
	await writeFiles(dir, { 'a.ts': 'one\ntwo\n' });
	commitAll(dir, 'Change a');
	git(dir, ['checkout', 'main']);
	await writeFiles(dir, { 'base-only.ts': 'landed on main\n' });

	const mainTip = commitAll(dir, 'Land on main');

	return { dir, forkPoint, mainTip };
}

test('a range review diffs from the merge base, so commits that landed on the base are left out', async () => {
	const { dir, forkPoint, mainTip } = await divergedRepository();

	const resolved = await resolveTarget(
		targetRequest(dir, { kind: 'range', base: 'main', head: 'feature', start: { kind: 'continue' } })
	);

	expect(resolved.diff).toContain('+two');
	expect(resolved.diff).not.toContain('base-only.ts');
	expect(resolved.revision?.mergeBaseSha).toBe(forkPoint);
	expect(resolved.report.baseSha).toBe(mainTip);
	expect(resolved.report.changedFiles).toBe(1);

	await resolved.dispose();
});

test('a range with no base compares against main when the repository has no origin remote', async () => {
	const { dir } = await divergedRepository();

	const resolved = await resolveTarget(
		targetRequest(dir, { kind: 'range', base: null, head: 'feature', start: { kind: 'continue' } })
	);

	expect(resolved.report.base).toBe('main');

	await resolved.dispose();
});

test('a range with no base and no default branch asks for --base', async () => {
	const dir = await userRepository();

	git(dir, ['branch', '-m', 'main', 'trunk']);

	const resolving = resolveTarget(
		targetRequest(dir, { kind: 'range', base: null, head: 'trunk', start: { kind: 'continue' } })
	);

	await expect(resolving).rejects.toMatchObject({
		exitCode: EXIT.notReady,
		message: expect.stringContaining('--base')
	});
});

test('a revision that starts with a dash is refused before git can read it as an option', async () => {
	const dir = await userRepository();

	const resolving = resolveTarget(
		targetRequest(dir, { kind: 'range', base: 'main', head: '--output=/tmp/owned', start: { kind: 'continue' } })
	);

	await expect(resolving).rejects.toMatchObject({ exitCode: EXIT.usage });
	expect(checkoutsOf(dir)).toEqual([]);
});
