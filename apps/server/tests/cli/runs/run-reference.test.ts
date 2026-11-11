import { expect, test } from 'bun:test';
import { EXIT } from '../../../src/cli/exit';
import { parseRunReference, resolveRunReference } from '../../../src/cli/runs/run-reference';
import { runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

const usageError = expect.objectContaining({ exitCode: EXIT.usage });

test('no run named means the newest run on disk', async () => {
	await storeRun(runIdAt(1));
	await storeRun(runIdAt(2));

	expect(await resolveRunReference(parseRunReference(undefined))).toBe(runIdAt(2));
});

test('with no runs at all, the newest run is a usage error that says how to start one', async () => {
	await expect(resolveRunReference({ kind: 'newest' })).rejects.toThrow('recoder review');
});

test('a part of an id names the one run that holds it', async () => {
	await storeRun(runIdAt(1));
	await storeRun(runIdAt(22));

	expect(await resolveRunReference(parseRunReference('100022'))).toBe(runIdAt(22));
});

test('a part that several runs end with is a usage error naming them, and picks none', async () => {
	await storeRun(runIdAt(1));
	await storeRun(runIdAt(2));

	const resolving = resolveRunReference(parseRunReference('abcdef'));

	await expect(resolving).rejects.toMatchObject({ exitCode: EXIT.usage, message: expect.stringContaining(runIdAt(1)) });
});

test('a part no run holds is a usage error', async () => {
	await storeRun(runIdAt(1));

	await expect(resolveRunReference(parseRunReference('ffffff'))).rejects.toMatchObject({ exitCode: EXIT.usage });
});

test.each(['..', '../abc', 'a/b', 'ab', 'zzzzzz', 'ABCDEF'])(
	'%s could not be part of a run id and is refused before the disk is read',
	(text) => {
		expect(() => parseRunReference(text)).toThrow(usageError);
	}
);
