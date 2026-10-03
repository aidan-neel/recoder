import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateEdit, patchFromEdits, suggestFix } from '../../../src/review/fixes/fix';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';

function sh(cwd: string, args: string[]): void {
	const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' });

	if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

const hasGit = (): boolean => {
	try {
		return Bun.spawnSync(['git', '--version'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
	} catch {
		return false;
	}
};

const it = hasGit() ? test : test.skip;

async function seedRepo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-test-'));

	sh(dir, ['init', '-b', 'main']);
	sh(dir, ['config', 'user.email', 'test@test']);
	sh(dir, ['config', 'user.name', 'test']);
	await writeFile(join(dir, 'a.ts'), 'const x = 1;\nconsole.log(x);\n');
	sh(dir, ['add', 'a.ts']);
	sh(dir, ['commit', '-m', 'init']);

	return dir;
}

describe('fix edits', () => {
	test('an edit copied with the excerpt line numbers still finds its place', () => {
		const content = 'function a() {\n\treturn 1;\n}\n';

		expect(locateEdit(content, '2: \treturn 1;')).toEqual({ start: 15, end: 25 });
	});

	test('an edit matching more than one place is refused', () => {
		expect(locateEdit('x = 1;\nx = 1;\n', 'x = 1;')).toBeNull();
	});

	it('patches built from edits use repo paths', async () => {
		const dir = await seedRepo();
		const patch = await patchFromEdits(dir, [{ file: 'a.ts', find: 'const x = 1;', replace: 'const x = 3;' }]);

		expect(patch).toContain('--- a/a.ts\n+++ b/a.ts\n');
		expect(patch).toContain('-const x = 1;\n+const x = 3;');
	});
});

describe('suggestFix', () => {
	it('retries without thinking when the first reply is cut off at the output limit', async () => {
		const dir = await seedRepo();
		const settings = getStoredSettings();

		setReviewOverrides({
			baseUrl: 'http://model.test/v1',
			apiKey: 'test',
			models: [{ id: 'test', label: 'Test', model: 'test' }]
		});

		const bodies: Record<string, unknown>[] = [];

		const replies = [
			{ choices: [{ finish_reason: 'length', message: { content: '' } }] },
			{
				choices: [
					{
						message: {
							content: JSON.stringify({
								summary: 'Bump x.',
								edits: [{ file: 'a.ts', find: 'const x = 1;', replace: 'const x = 2;' }]
							})
						}
					}
				]
			}
		];

		const originalFetch = globalThis.fetch;

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));

			return Response.json(replies.shift());
		}) as unknown as typeof fetch;

		try {
			const fix = await suggestFix({
				agent: 'correctness',
				file: 'a.ts',
				line: 1,
				endLine: 1,
				severity: 'low',
				message: 'x should be 2',
				diff: '',
				sandboxPath: dir
			});

			expect(fix.patch).toContain('+const x = 2;');
			expect(bodies).toHaveLength(2);
			expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: false });
		} finally {
			globalThis.fetch = originalFetch;
			setReviewOverrides(settings);
		}
	});
});
