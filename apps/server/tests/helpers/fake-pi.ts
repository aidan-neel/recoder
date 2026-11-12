import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { fakeBin, loggedCalls } from './fake-bin';

/**
 * A fake `pi`, as a Bun script, that prints and saves what Pi 0.73.1 does (seen in a real run against a local
 * model). Like Pi with a stdin that is not a terminal, `--version` and `--list-models` print to stderr: the version,
 * and Pi's table or, in `auth` mode, its `No models available` line. Print mode appends `{args, cwd, stdin, system, extension, resumed, env}` to `FAKE_PI_LOG` (one JSON
 * line per call), appends the call's entries to the `--session` file as Pi does, prints the answer, and acts on
 * `FAKE_PI_MODE`: an answer (default) of one model call with thinking and text; `tool` (loads the `--extension`
 * Recoder wrote with a stub of Pi's API, calls its `read_diff`, and answers with what it returned, in two model
 * calls); `auth` (Pi's `No API key found` on stderr, exit 1, nothing saved); `limit` (a model call that ended in a
 * quota error, exit 1); `garbage` (a session line and output that are not Pi's, carrying a fake credential); `flood`
 * (stdout without end); `unreadable-flood` (the same, after it saved the session header and made the file
 * unreadable); `crash` (stderr, exit 1); `spawn` (starts a `sleep` grandchild, writes `<own pid> <grandchild pid>`
 * to `<log>.pids` and waits for it); or `unreadable` (on a new session, makes the session file unreadable for
 * `FAKE_PI_DELAY_MS` after saving the prompt, then the answer).
 */
const SCRIPT = `#!/usr/bin/env bun
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_PI_MODE ?? 'answer';
const log = process.env.FAKE_PI_LOG;

if (args[0] === '--version') {
	console.error('0.73.1');
	process.exit(0);
}

if (args.includes('--list-models')) {
	if (mode === 'auth') {
		console.error('No models available. Use /login to log into a provider via OAuth or API key. See:');
		process.exit(0);
	}

	console.error('provider   model              context  max-out  thinking  images');
	console.error('anthropic  claude-sonnet-4-5  200K     64K      yes       yes   ');
	console.error('local      m2                 128K     16.4K    no        no    ');
	process.exit(0);
}

const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const stdin = await Bun.stdin.text();
const sessionFile = flag('--session');
const extension = flag('--extension');
const resumed = existsSync(sessionFile);

appendFileSync(
	log,
	JSON.stringify({
		args,
		cwd: process.cwd(),
		stdin,
		system: readFileSync(flag('--system-prompt'), 'utf8'),
		extension: extension ? readFileSync(extension, 'utf8') : null,
		resumed,
		env: process.env
	}) + '\\n'
);

if (mode === 'auth') {
	console.error('No API key found for anthropic.\\n\\nUse /login to log into a provider via OAuth or API key. See:\\n  /pi/docs/providers.md');
	process.exit(1);
}

if (mode === 'crash') {
	console.error('boom');
	process.exit(1);
}

if (mode === 'unreadable-flood') {
	mkdirSync(dirname(sessionFile), { recursive: true });
	writeFileSync(sessionFile, JSON.stringify({ type: 'session', version: 3, id: 'sess-1', timestamp: '2026-11-12T09:53:34.527Z', cwd: process.cwd() }) + '\\n');
	chmodSync(sessionFile, 0o000);
}

if (mode === 'flood' || mode === 'unreadable-flood') {
	const chunk = 'x'.repeat(1024 * 1024) + '\\n';

	for (;;) await Bun.write(Bun.stdout, chunk);
}

if (mode === 'spawn') {
	const child = Bun.spawn(['sleep', '30']);

	writeFileSync(log + '.pids', process.pid + ' ' + child.pid);
	await child.exited;
}

const delayMs = Number(process.env.FAKE_PI_DELAY_MS ?? 0);

mkdirSync(dirname(sessionFile), { recursive: true });

if (mode === 'garbage') {
	const line = 'Authorization: Bearer fake-credential-123 is not a session entry';

	appendFileSync(sessionFile, line + '\\n');
	console.log(line);
	console.error(line);
	process.exit(0);
}

let entries = resumed ? readFileSync(sessionFile, 'utf8').trim().split('\\n').length : 0;

const save = (entry) => appendFileSync(sessionFile, JSON.stringify({ id: 'e' + ++entries, parentId: null, timestamp: '2026-11-12T09:53:34.554Z', ...entry }) + '\\n');
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const usage = { input: 60, output: 20, cacheRead: 40, cacheWrite: 0, totalTokens: 120, cost };
const reply = (content, stopReason, extra = {}) =>
	save({ type: 'message', message: { role: 'assistant', content, api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-5', usage, stopReason, timestamp: 1, ...extra } });

if (!resumed) appendFileSync(sessionFile, JSON.stringify({ type: 'session', version: 3, id: 'sess-1', timestamp: '2026-11-12T09:53:34.527Z', cwd: process.cwd() }) + '\\n');

save({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: stdin }], timestamp: 1 } });

if (mode === 'unreadable' && !resumed) {
	chmodSync(sessionFile, 0o000);
	await Bun.sleep(delayMs);
	chmodSync(sessionFile, 0o644);
}

if (mode === 'limit') {
	const message = '429 You exceeded your current quota, please check your plan and billing details.';

	reply([], 'error', { errorMessage: message });
	console.error(message);
	process.exit(1);
}

const results = [];

if (mode === 'tool') {
	const tools = [];

	await (await import(extension)).default({ registerTool: (tool) => tools.push(tool) });

	const readDiff = tools.find((tool) => tool.name === 'read_diff');

	reply([{ type: 'toolCall', id: 'call_1', name: 'read_diff', arguments: { path: 'file0.ts' } }], 'toolUse');

	try {
		const result = await readDiff.execute('call_1', { path: 'file0.ts' }, AbortSignal.timeout(5000));

		results.push({ isError: false, text: result.content[0].text });
	} catch (error) {
		results.push({ isError: true, text: error.message });
	}

	save({ type: 'message', message: { role: 'toolResult', toolCallId: 'call_1', toolName: 'read_diff', content: [{ type: 'text', text: results[0].text }], isError: results[0].isError, timestamp: 1 } });
}

const answer = JSON.stringify({ done: true, results });

reply([{ type: 'thinking', thinking: 'Hmm.', thinkingSignature: 'sig' }, { type: 'text', text: answer }], 'stop');
console.log(answer);
`;

/** A fake `pi` on PATH, a log for it, and an agent dir of its own, plus `extra`, as the environment an adapter runs with. */
export async function fakePi(extra: Record<string, string> = {}): Promise<Record<string, string>> {
	const { env } = await fakeBin('pi', SCRIPT);
	const dir = await mkdtemp(join(tmpdir(), 'fake-pi-'));

	return { ...env, HOME: dir, PI_CODING_AGENT_DIR: join(dir, 'agent'), FAKE_PI_LOG: join(dir, 'log'), ...extra };
}

const callSchema = z.object({
	args: z.array(z.string()),
	cwd: z.string(),
	stdin: z.string(),
	system: z.string(),
	extension: z.string().nullable(),
	resumed: z.boolean(),
	env: z.record(z.string(), z.string())
});

export type FakePiCall = z.infer<typeof callSchema>;

/** What the fake logged for each print-mode call, in order. */
export async function fakePiCalls(env: Record<string, string>): Promise<FakePiCall[]> {
	return z.array(callSchema).parse(await loggedCalls(env.FAKE_PI_LOG ?? ''));
}
