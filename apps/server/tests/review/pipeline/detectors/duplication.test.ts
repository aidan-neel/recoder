import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { runDetectors } from '../../../../src/review/pipeline/detectors/detectors';
import { git } from '../../../helpers/git';
import { twoCommitRepo } from '../harness-fixtures';

/** A function long enough (well over 60 tokens) to count as a clone when copied. */
function parser(name: string): string {
	return `export function ${name}(input: string): { key: string; value: number }[] {
	const rows: { key: string; value: number }[] = [];

	for (const line of input.split('\\n')) {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith('#')) continue;

		const [key, raw] = trimmed.split('=');
		const value = Number(raw);

		if (Number.isNaN(value)) throw new Error(\`bad value for \${key}: \${raw}\`);

		rows.push({ key: key.trim(), value });
	}

	return rows.sort((a, b) => a.key.localeCompare(b.key));
}
`;
}

test('reports added code that repeats an existing file, pointing at the other copy, and nothing for new code or test files', async () => {
	const root = await mkdtemp(join(tmpdir(), 'recoder-dup-'));

	const { targetSha, headSha } = await twoCommitRepo(root, {
		base: { 'src/settings.ts': parser('parseSettings') },
		head: {
			'src/limits.ts': `import { x } from './x';\n\n${parser('parseLimits')}`,
			'src/unique.ts': 'export const answer = 42;\n',
			'tests/limits.test.ts': parser('parseInTest')
		}
	});

	const diff = git(root, ['diff', targetSha, headSha]);

	const run = createRun({
		diff: `${diff}\n`,
		sandboxPath: null,
		revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
	});

	const results = (await runDetectors(run)).filter((result) => result.detector === 'duplication');

	expect(results).toHaveLength(1);
	expect(results[0]).toMatchObject({ file: 'src/limits.ts', category: 'duplication', line: 3 });
	expect(results[0].relatedLocations).toEqual([{ file: 'src/settings.ts', line: 1, endLine: 18 }]);
});
