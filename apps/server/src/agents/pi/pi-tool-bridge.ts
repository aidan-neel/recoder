import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmError } from '../../models/llm/errors';
import type { ToolLease } from '../tools/mcp-host';

/** Pi's built-in tools. A Recoder tool may not share a name: `--tools` would then turn the built-in on. */
const PI_BUILT_IN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

/** Every tool off, built-in and extension: a call that only answers. */
export const NO_TOOLS_ARGS = ['--no-tools'];

/**
 * The extension that gives Pi Recoder's tools. Pi has no MCP client by design, so this one asks Recoder's MCP
 * server (`SERVER_URL`, put in front of this text) for the tools the run may use, registers each, and forwards
 * every call to the server, where the review gate decides it. A refused or failed call throws, which Pi reports to
 * the model as a tool error. It reaches nothing but that URL.
 */
const BRIDGE_SOURCE = `
let nextId = 0;

async function call(method, params, signal) {
	const response = await fetch(SERVER_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
		signal
	});

	if (!response.ok) throw new Error('Recoder answered ' + response.status + ' to ' + method + '.');

	const message = await response.json();

	if (message.error) throw new Error('Recoder refused ' + method + ': ' + message.error.message);

	return message.result;
}

function text(result) {
	return (result.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\\n');
}

export default async function (pi) {
	const { tools } = await call('tools/list', {}, AbortSignal.timeout(10000));

	for (const tool of tools) {
		pi.registerTool({
			name: tool.name,
			label: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
			async execute(_toolCallId, params, signal) {
				const result = await call('tools/call', { name: tool.name, arguments: params }, signal);

				if (result.isError) throw new Error(text(result));

				return { content: [{ type: 'text', text: text(result) }], details: {} };
			}
		});
	}
}
`;

/**
 * Writes the extension for `lease` into `dir` (owner-only, since it holds the slot's URL) and returns the flags that
 * load it and allow only its tools. It is plain JavaScript (`.mjs`): Pi's loader caches a transpiled copy of a `.ts`
 * extension under the temp dir, which would outlive the run's scratch dir with the URL in it. `--tools` is an
 * allowlist that leaves every built-in tool unregistered, and `--no-builtin-tools` says the same, so neither flag
 * alone opens one.
 */
export async function writeToolBridge(dir: string, lease: ToolLease, tools: readonly string[]): Promise<string[]> {
	const clash = tools.find((name) => PI_BUILT_IN_TOOLS.includes(name));

	if (clash) throw new LlmError(0, `Recoder's tool ${clash} has the name of one of Pi's own tools.`);

	const file = join(dir, 'recoder-tools.mjs');

	await writeFile(file, `const SERVER_URL = ${JSON.stringify(lease.url)};\n${BRIDGE_SOURCE}`, { mode: 0o600 });

	return ['--no-builtin-tools', '--tools', tools.join(','), '--extension', file];
}
