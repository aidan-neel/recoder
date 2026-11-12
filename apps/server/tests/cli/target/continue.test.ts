import { afterAll, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../../../src/cli/exit';
import type { ReviewTarget } from '../../../src/cli/review/options';
import { resolveTarget, type ResolvedTarget } from '../../../src/cli/target/resolve-target';
import { git } from '../../helpers/git';
import { runIdAt, storeReview, useFreshDataDir, type StoredReview } from '../runs/run-fixtures';
import {
	commitAll,
	localForge,
	rejection,
	removeFixtureFolders,
	targetRequest,
	userRepository,
	writeFiles
} from './fixture';

useFreshDataDir();

afterAll(removeFixtureFolders);

const CONTINUE: ReviewTarget = { kind: 'range', base: 'main', head: 'feature', start: { kind: 'continue' } };

const WHOLE: ReviewTarget = { kind: 'range', base: 'main', head: 'feature', start: { kind: 'whole' } };

const FIRST: CommitStep = { files: { 'a.ts': 'one\ntwo\n' }, message: 'first change' };

const SECOND: CommitStep = { files: { 'b.ts': 'brand new\n' }, message: 'second change' };

/** One commit of a feature branch: the files it writes and its message. */
interface CommitStep {
	files: Record<string, string>;
	message: string;
}

/** A repo with `feature` branched from `main`, holding the given commits in order; `heads` are their SHAs. */
async function featureRepo(steps: CommitStep[]): Promise<{ dir: string; mainSha: string; heads: string[] }> {
	const dir = await userRepository();
	const mainSha = git(dir, ['rev-parse', 'main']);

	git(dir, ['checkout', '-b', 'feature']);

	const heads: string[] = [];

	for (const step of steps) {
		await writeFiles(dir, step.files);
		heads.push(commitAll(dir, step.message));
	}

	return { dir, mainSha, heads };
}

/** The stored report of an earlier review of `headSha` against `baseSha`; `review` adjusts it. */
function earlierReview(headSha: string, baseSha: string, review: StoredReview = {}): Promise<void> {
	return storeReview(runIdAt(1), {
		...review,
		target: { headSha, baseSha, mergeBaseSha: baseSha, ...review.target }
	});
}

/** The review CONTINUE resolves to in `dir` when no earlier run counts: the whole change from `mainSha`. */
async function wholeReview(dir: string, mainSha: string): Promise<ResolvedTarget> {
	const resolved = await resolveTarget(targetRequest(dir, CONTINUE));

	expect(resolved.report.since).toBeNull();
	expect(resolved.report.sinceRunId).toBeNull();
	expect(resolved.report.mergeBaseSha).toBe(mainSha);

	return resolved;
}

test('a second review of a branch covers only the commits after the last review', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha);

	const resolved = await resolveTarget(targetRequest(dir, CONTINUE));

	expect(resolved.report.since).toBe(heads[0]);
	expect(resolved.report.sinceRunId).toBe(runIdAt(1));
	expect(resolved.report.mergeBaseSha).toBe(heads[0]);
	expect(resolved.revision?.mergeBaseSha).toBe(heads[0]);
	expect(resolved.diff).toContain('b.ts');
	expect(resolved.diff).not.toContain('+two');

	await resolved.dispose();
});

test('--full reviews the whole change after an earlier review', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha);

	const resolved = await resolveTarget(targetRequest(dir, WHOLE));

	expect(resolved.report.since).toBeNull();
	expect(resolved.report.sinceRunId).toBeNull();
	expect(resolved.report.mergeBaseSha).toBe(mainSha);
	expect(resolved.diff).toContain('b.ts');
	expect(resolved.diff).toContain('+two');

	await resolved.dispose();
});

test('a review with no new commit since the last one is a usage error naming the run and --full', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST]);

	await earlierReview(heads[0], mainSha);

	const error = await rejection(resolveTarget(targetRequest(dir, CONTINUE)));

	expect(error).toMatchObject({ exitCode: EXIT.usage });
	expect(error.message).toContain('Nothing to review');
	expect(error.message).toContain(runIdAt(1));
	expect(error.message).toContain(heads[0].slice(0, 7));
	expect(error.message).toContain('--full');
});

test('after a rebase the earlier head is no longer an ancestor and the whole change is reviewed', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST]);

	await earlierReview(heads[0], mainSha);

	git(dir, ['reset', '--hard', 'main']);
	await writeFiles(dir, { 'a.ts': 'one\nTWO\n' });
	commitAll(dir, 'rebased change');

	const resolved = await wholeReview(dir, mainSha);

	expect(resolved.diff).toContain('+TWO');

	await resolved.dispose();
});

/** Adds a commit to `main` that the feature branch does not have, and goes back to `feature`. Returns the commit. */
async function mainMovesOn(dir: string): Promise<string> {
	git(dir, ['checkout', 'main']);
	await writeFiles(dir, { 'main-only.ts': 'later\n' });

	const sha = commitAll(dir, 'main moves on');

	git(dir, ['checkout', 'feature']);

	return sha;
}

test('an earlier review still counts after the base moved forward', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha);
	await mainMovesOn(dir);

	const resolved = await resolveTarget(targetRequest(dir, CONTINUE));

	expect(resolved.report.since).toBe(heads[0]);
	expect(resolved.diff).toContain('b.ts');
	expect(resolved.diff).not.toContain('+two');

	await resolved.dispose();
});

test('after the base is merged into the branch the whole change is reviewed', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST]);

	await earlierReview(heads[0], mainSha);

	const newMain = await mainMovesOn(dir);

	git(dir, ['merge', '--no-edit', 'main']);

	const resolved = await wholeReview(dir, newMain);

	expect(resolved.diff).toContain('+two');

	await resolved.dispose();
});

test('an earlier review against a base the branch began after does not count', async () => {
	const dir = await userRepository();
	const mainSha = git(dir, ['rev-parse', 'main']);

	git(dir, ['checkout', '-b', 'develop']);
	await writeFiles(dir, { 'dev.ts': 'develop only\n' });

	const developSha = commitAll(dir, 'develop work');

	git(dir, ['checkout', '-b', 'feature']);
	await writeFiles(dir, FIRST.files);
	await earlierReview(commitAll(dir, FIRST.message), developSha);

	const resolved = await wholeReview(dir, mainSha);

	expect(resolved.diff).toContain('+two');
	expect(resolved.diff).toContain('dev.ts');

	await resolved.dispose();
});

test('an earlier review whose base was behind where the branch began does not count', async () => {
	const dir = await userRepository();
	const staleSha = git(dir, ['rev-parse', 'main']);

	await writeFiles(dir, { 'auth.ts': 'allow = true\n' });

	const mainSha = commitAll(dir, 'main moves on');

	git(dir, ['checkout', '-b', 'feature']);
	await writeFiles(dir, { 'auth.ts': 'allow = false\n' });
	await earlierReview(commitAll(dir, 'undo the change on main'), staleSha);

	const resolved = await wholeReview(dir, mainSha);

	expect(resolved.diff).toContain('auth.ts');

	await resolved.dispose();
});

test('a newer run that names a commit from elsewhere is skipped, and the review before it is continued', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha);
	await storeReview(runIdAt(2), { target: { headSha: 'f'.repeat(40), baseSha: mainSha, mergeBaseSha: mainSha } });

	const resolved = await resolveTarget(targetRequest(dir, CONTINUE));

	expect(resolved.report.since).toBe(heads[0]);
	expect(resolved.report.sinceRunId).toBe(runIdAt(1));

	await resolved.dispose();
});

test('a stored head that is not a whole commit SHA does not count', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0].slice(0, 12), mainSha);

	const resolved = await wholeReview(dir, mainSha);

	await resolved.dispose();
});

test('a review narrowed to some paths also continues after the last review', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha);

	const narrowed = targetRequest(dir, CONTINUE, { scope: { include: ['b.ts'], exclude: [] } });
	const resolved = await resolveTarget(narrowed);

	expect(resolved.report.since).toBe(heads[0]);
	expect(resolved.diff).toContain('b.ts');

	await resolved.dispose();
});

test('new commits that change nothing in scope are refused with the commit the review started after, its run and --full', async () => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha);

	const narrowed = targetRequest(dir, CONTINUE, { scope: { include: ['a.ts'], exclude: [] } });
	const error = await rejection(resolveTarget(narrowed));

	expect(error).toMatchObject({ exitCode: EXIT.usage });
	expect(error.message).toContain(`between ${heads[0].slice(0, 7)} and feature`);
	expect(error.message).toContain(runIdAt(1));
	expect(error.message).toContain('--full');
});

/** Earlier reviews that must not count as the last review, each narrowed or started at a named commit. */
const NOT_COUNTED: [string, (mainSha: string) => StoredReview][] = [
	['--include', () => ({ settings: { include: ['src/**'] } })],
	['--exclude', () => ({ settings: { exclude: ['docs/**'] } })],
	['--lens', () => ({ settings: { lenses: ['correctness'] } })],
	['a named --since', (mainSha) => ({ target: { since: mainSha, sinceRunId: null } })]
];

test.each(NOT_COUNTED)('the earlier review with %s does not count', async (_, review) => {
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND]);

	await earlierReview(heads[0], mainSha, review(mainSha));

	const resolved = await wholeReview(dir, mainSha);

	expect(resolved.diff).toContain('+two');
	expect(resolved.diff).toContain('b.ts');

	await resolved.dispose();
});

test('a review that continued an earlier one is itself a review later runs continue from', async () => {
	const third: CommitStep = { files: { 'c.ts': 'third\n' }, message: 'third change' };
	const { dir, mainSha, heads } = await featureRepo([FIRST, SECOND, third]);

	await earlierReview(heads[0], mainSha);

	await storeReview(runIdAt(2), {
		target: {
			headSha: heads[1],
			baseSha: mainSha,
			mergeBaseSha: heads[0],
			since: heads[0],
			sinceRunId: runIdAt(1)
		}
	});

	const resolved = await resolveTarget(targetRequest(dir, CONTINUE));

	expect(resolved.report.since).toBe(heads[1]);
	expect(resolved.report.sinceRunId).toBe(runIdAt(2));
	expect(resolved.diff).toContain('c.ts');
	expect(resolved.diff).not.toContain('b.ts');

	await resolved.dispose();
});

test.each(['staged', 'uncommitted'] as const)('a %s review never continues an earlier review', async (kind) => {
	const { dir, mainSha, heads } = await featureRepo([FIRST]);

	await earlierReview(heads[0], mainSha);
	await writeFiles(dir, { 'wip.ts': 'work in progress\n' });

	if (kind === 'staged') git(dir, ['add', 'wip.ts']);

	const target: ReviewTarget = kind === 'staged' ? { kind: 'staged' } : { kind: 'uncommitted' };
	const resolved = await resolveTarget(targetRequest(dir, target));

	expect(resolved.report.since).toBeNull();
	expect(resolved.report.sinceRunId).toBeNull();

	await resolved.dispose();
});

test('a range review counts for a later pull review of the same commits', async () => {
	const forge = await localForge();
	const dir = await userRepository();
	const runId = runIdAt(1);

	await storeReview(runId, {
		target: { kind: 'range', headSha: forge.pull7Head, baseSha: forge.squash, mergeBaseSha: forge.squash }
	});

	const forgeDir = fileURLToPath(forge.repo.url);

	git(forgeDir, ['checkout', 'feature']);
	await writeFiles(forgeDir, { 'extra.ts': 'export const x = 1;\n' });

	const newHead = commitAll(forgeDir, 'Add extra');

	git(forgeDir, ['update-ref', 'refs/pull/7/head', newHead]);
	git(forgeDir, ['checkout', 'main']);

	const resolved = await resolveTarget(
		targetRequest(dir, { kind: 'pull', pull: `${forge.repo.url}#pull/7`, start: { kind: 'continue' } })
	);

	expect(resolved.report.kind).toBe('pull');
	expect(resolved.report.since).toBe(forge.pull7Head);
	expect(resolved.report.sinceRunId).toBe(runId);
	expect(resolved.report.mergeBaseSha).toBe(forge.pull7Head);
	expect(resolved.diff).toContain('extra.ts');
	expect(resolved.diff).not.toContain('new.ts');

	await resolved.dispose();
});
