import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { claudeCodeEnv } from '../../../src/agents/claude-code/claude-code-process';
import { allGone, fakeClaude, fakeClaudeLog, spawnedPids } from '../../helpers/fake-claude';

const AGENT = resolve(import.meta.dir, '../../../src/agents/claude-code/claude-code.ts');

/** A server stand-in: one Claude Code call through the shared instance, then idle until it is signalled. */
const SERVER = `import { claudeCode } from ${JSON.stringify(AGENT)};
void claudeCode
	.complete({ provider: 'claude-code', baseUrl: '', apiKey: '', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] })
	.catch(() => {});
setInterval(() => {}, 1000);
`;

test('the CLI environment drops keys, tokens and secrets in any case, and keeps the rest', () => {
	expect(
		claudeCodeEnv({
			PATH: '/bin',
			HOME: '/home/reviewer',
			http_proxy: 'http://proxy.test',
			CLAUDE_CONFIG_DIR: '/c',
			anthropic_api_key: 'k',
			ClaudeCode: '1',
			MY_SECRET_VALUE: 's',
			DB_PASSWORD: 'p',
			UNSET: undefined
		})
	).toEqual({ PATH: '/bin', HOME: '/home/reviewer', http_proxy: 'http://proxy.test', CLAUDE_CONFIG_DIR: '/c' });
});

describe('shutdown', () => {
	test.each([
		['SIGTERM', 143],
		['SIGINT', 130]
	] as const)(
		'%s ends the server with its usual code, kills the running CLI and its children and deletes the prompt file',
		async (signal, code) => {
			const log = await fakeClaudeLog();
			const dir = await mkdtemp(join(tmpdir(), 'claude-code-shutdown-'));
			const fake = await fakeClaude({ FAKE_CLAUDE_MODE: 'spawn', FAKE_CLAUDE_LOG: log });
			const script = join(dir, 'server.ts');

			await writeFile(script, SERVER);

			const server = Bun.spawn([process.execPath, script], {
				env: {
					...fake,
					HOME: process.env.HOME ?? dir,
					RECODER_DATA_DIR: dir,
					RECODER_CLAUDE_BIN: join(fake.PATH.split(':')[0], 'claude')
				},
				stdout: 'ignore',
				stderr: 'ignore'
			});

			const pids = await spawnedPids(log);
			const systemFile = (await readFile(log, 'utf8')).match(/\[--system-prompt-file\] \[([^\]]+)\]/)?.[1];

			server.kill(signal);

			expect(await server.exited).toBe(code);
			expect(await allGone(pids)).toBe(true);
			expect(systemFile && existsSync(systemFile)).toBe(false);
		}
	);
});
