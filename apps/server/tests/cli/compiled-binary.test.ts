import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnvironment } from './child-env';

const MAIN = join(import.meta.dir, '../../src/cli/main.ts');

const BASE = 'export function a(x: number) {\n\treturn x + 1;\n}\n';

/** A different length from the base, so git sees the change even when both writes land in the same second. */
const CHANGE = `${BASE}export const b = a(2);\n`;

let folder: string;
let binary: string;
let stub: ReturnType<typeof Bun.serve>;
let modelCalls = 0;

/** A reply an OpenAI-compatible endpoint streams: one chunk with no findings, then the end. */
function completion(): Response {
	const chunk = (choice: object) =>
		`data: ${JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', model: 'stub', choices: [{ index: 0, ...choice }] })}\n\n`;

	const body =
		chunk({ delta: { role: 'assistant', content: '{"findings":[]}' }, finish_reason: null }) +
		chunk({ delta: {}, finish_reason: 'stop' }) +
		'data: [DONE]\n\n';

	return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' });

	if (!result.success) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
}

beforeAll(async () => {
	folder = realpathSync(mkdtempSync(join(tmpdir(), 'recoder-binary-')));
	binary = join(folder, 'recoder');

	stub = Bun.serve({
		port: 0,
		fetch: () => {
			modelCalls++;

			return completion();
		}
	});

	const build = Bun.spawn(['bun', 'build', '--compile', MAIN, '--outfile', binary], {
		stdout: 'ignore',
		stderr: 'pipe'
	});

	if ((await build.exited) !== 0) throw new Error(await new Response(build.stderr).text());
}, 60_000);

afterAll(() => {
	stub.stop(true);
	rmSync(folder, { recursive: true, force: true });
});

test('the compiled binary reviews a change with every file it reads at run time inside it', async () => {
	const repo = join(folder, 'repo');
	const data = join(folder, 'data');

	Bun.spawnSync(['mkdir', '-p', repo]);
	git(repo, 'init', '-q', '-b', 'main');
	writeFileSync(join(repo, 'a.ts'), BASE);
	git(repo, 'add', '.');
	git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
	writeFileSync(join(repo, 'a.ts'), CHANGE);

	const review = Bun.spawn([binary, 'review', '-p', '--uncommitted', '--repo', repo, '--no-exec', '--budget', 'low'], {
		cwd: folder,
		env: {
			...childEnvironment(data),
			RECODER_REVIEW_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
			RECODER_REVIEW_MODEL: 'stub'
		},
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		review.exited,
		new Response(review.stdout).text(),
		new Response(review.stderr).text()
	]);

	expect({ exitCode, stderr: exitCode === 0 ? '' : stderr }).toEqual({ exitCode: 0, stderr: '' });
	expect(JSON.parse(stdout).outcome).toBe('complete');
	expect(modelCalls).toBeGreaterThan(0);

	const facts = new Database(join(data, 'cache', 'facts.db'), { readonly: true });

	const parsed = facts.query("SELECT count(*) AS n FROM facts WHERE namespace = 'parsed-symbols'").get() as {
		n: number;
	};

	facts.close();
	expect(parsed.n).toBeGreaterThan(0);
}, 30_000);
