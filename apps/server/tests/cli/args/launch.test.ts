import { expect, test } from 'bun:test';
import { backgroundFlags } from '../../../src/cli/args/launch';
import { parseReviewArgs } from '../../../src/cli/args/review-args';
import { parseRunId } from '../../../src/cli/runs/run-id';
import { EXIT } from '../../../src/cli/exit';

const RUN_ID = '20261110-153045-a1b2c3';

const launchOf = (...argv: string[]) => parseReviewArgs(argv, '/work').launch;

test('--detach starts the same review in the background with every other flag as the caller wrote it', () => {
	expect(launchOf('--staged', '--detach', '--title=--detach', '--budget', 'medium')).toEqual({
		kind: 'detach',
		flags: ['--staged', '--title=--detach', '--budget', 'medium']
	});
});

test('--detach with a diff from standard input is a usage error, since a background process has none', () => {
	expect(() => launchOf('--detach', '--diff', '-')).toThrow(expect.objectContaining({ exitCode: EXIT.usage }));
	expect(launchOf('--detach', '--diff', 'change.patch').kind).toBe('detach');
});

test('a background run id that is not a run id is a usage error', () => {
	expect(() => launchOf('--run-id', '../../etc')).toThrow(expect.objectContaining({ exitCode: EXIT.usage }));
});

test('a caller cannot pass its own run id beside --detach, in either spelling', () => {
	for (const smuggled of [['--run-id', RUN_ID], [`--run-id=${RUN_ID}`]]) {
		expect(() => launchOf('--detach', ...smuggled)).toThrow(expect.objectContaining({ exitCode: EXIT.usage }));
	}
});

test('the background process reads its run id even when the caller ended the flags with --', () => {
	const { flags } = detachFlags(launchOf('--staged', '--detach', '--'));

	const runId = parseRunId(RUN_ID);

	expect(launchOf(...backgroundFlags(runId, flags))).toEqual({ kind: 'background', runId });
});

function detachFlags(launch: ReturnType<typeof launchOf>): { flags: string[] } {
	if (launch.kind !== 'detach') throw new Error(`expected a detach launch; got ${launch.kind}`);

	return launch;
}
