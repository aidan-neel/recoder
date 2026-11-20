import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { DevinAgent } from '../../../src/agents/devin/devin';
import { fakeDevin } from '../../helpers/fake-devin';
import { openCollectingRun } from '../../helpers/native-agent';

/** Exercises a refused local call followed by a real call to the leased Recoder MCP endpoint. */
const BLOCKED_CALL = `
const config = JSON.parse(await Bun.file(process.env.XDG_CONFIG_HOME + '/devin/config.json').text());
const hooks = config.hooks.PreToolUse;
const hook = hooks.find(h => new RegExp(h.matcher).test('exec')).hooks[0];
const child = Bun.spawn(['sh', '-c', hook.command], {stdin: 'pipe', stdout: 'pipe'});
child.stdin.end(JSON.stringify({tool_name: 'exec', tool_input: {command: 'touch SHOULD_NOT_EXIST'}}));
const refusal = JSON.parse(await new Response(child.stdout).text());
if (await child.exited !== 0 || refusal.decision !== 'block') process.exit(1);
const mcp = JSON.parse(await Bun.file('.devin/mcp_config.local.json').text());
const [server] = Object.values(mcp.mcpServers);
const response = await fetch(server.url, {method:'POST', body:JSON.stringify({jsonrpc:'2.0', id:1, method:'tools/call', params:{name:'read_file', arguments:{path:'index.js'}}})});
console.log(JSON.stringify({refusal, result: await response.json(), hidden:config.disabled_tools}));
`;

async function open(stage: 'verifier' | 'reviewer', flag?: string, tools = ['read_file', 'run']) {
	const env = await fakeDevin({
		FAKE_DEVIN_MODE: stage === 'verifier' && flag !== '0' && tools.length ? 'blockedtool' : 'reply',
		BLOCKED_TOOL_CALL: BLOCKED_CALL
	});

	if (flag !== undefined) env.RECODER_DEVIN_MCP_ONLY = flag;
	else delete env.RECODER_DEVIN_MCP_ONLY;

	const { run } = await openCollectingRun(new DevinAgent(env), {
		model: 'swe-2-flash-medium',
		system: 'Verify the finding.',
		tools,
		stage
	});

	return { run, log: env.FAKE_DEVIN_LOG! };
}

test('default verifier routing corrects a stale builtin and continues through its leased MCP tools', async () => {
	const { run } = await open('verifier');

	try {
		const reply = await run.prompt('Verify.', { tools: true, timeoutMs: 10_000 });
		const result = JSON.parse(reply.text);

		expect(reply.error).toBeUndefined();
		expect(result.refusal.decision).toBe('block');
		expect(result.refusal.reason).toMatch(/server_name=recoder\d+, tool_name=run/);
		expect(result.result.result.content[0].text).toBe('ok');
		expect(result.hidden).toContain('exec');
		expect(result.hidden).not.toContain('mcp_call_tool');
	} finally {
		await run.close();
	}
});

test('the hook names only an offered equivalent and never grants missing shell access', async () => {
	const { run } = await open('verifier', '1', ['read_file']);

	try {
		const reply = await run.prompt('Verify.', { tools: true, timeoutMs: 10_000 });
		const result = JSON.parse(reply.text);

		expect(result.refusal.decision).toBe('block');
		expect(result.refusal.reason).toContain('mcp_list_tools');
		expect(result.refusal.reason).not.toContain('tool_name=run');
	} finally {
		await run.close();
	}
});

test('opted-out, non-verifier and toolless sessions retain their existing permission policy', async () => {
	for (const [stage, flag, tools] of [
		['verifier', '0', ['read_file']],
		['reviewer', '1', ['read_file']],
		['verifier', '1', []]
	] as const) {
		const { run, log } = await open(stage, flag, [...tools]);

		try {
			expect((await run.prompt('Answer.', { tools: false, timeoutMs: 10_000 })).error).toBeUndefined();

			const config = JSON.parse((await readFile(log, 'utf8')).split('\nconfig: ')[1]);

			expect(config.disabled_tools).toBeUndefined();
			expect(config.hooks).toBeUndefined();
			expect(config.permissions.deny).toContain('exec');
		} finally {
			await run.close();
		}
	}
});
