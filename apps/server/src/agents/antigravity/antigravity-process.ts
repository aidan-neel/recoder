import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cliEnv, type CliLocation } from '../cli-process';
import type { ToolLease } from '../tools/mcp-host';

export type Env = Record<string, string | undefined>;

export const ANTIGRAVITY_LOGIN = 'agy acp --login';

/** Where the `agy` binary is: `RECODER_ANTIGRAVITY_BIN`, else PATH, else the installer's `~/.local/bin`. */
export const ANTIGRAVITY_CLI: CliLocation = {
	pin: 'RECODER_ANTIGRAVITY_BIN',
	command: 'agy',
	installed: ['.local', 'bin', 'agy']
};

/** The empty directory, under the data dir, that the short checks (models, usage) run `agy` in. */
export const ANTIGRAVITY_PROBE_DIR = 'antigravity-probe';

const CUSTOM_AGENT_NAME = 'recoder';

/**
 * Headless stream-json flags shared by single calls and multi-turn runs. Prompts enter as NDJSON on stdin so diffs
 * and review transcripts never approach OS argv limits, and slash commands stay disabled.
 */
export const ANTIGRAVITY_STREAM_ARGS = [
	'--input-format',
	'stream-json',
	'--output-format',
	'stream-json',
	'--disable-slash-commands',
	'--agent',
	CUSTOM_AGENT_NAME
];

/**
 * Variables stripped from the server environment before launching `agy`: Recoder's own secrets, Antigravity and
 * Gemini overrides (including ACP harness variables when Recoder itself runs inside an Antigravity host), and any
 * provider API key, token or password.
 */
const STRIPPED = [
	/^RECODER_/,
	/^AGY_/,
	/^ANTIGRAVITY_/,
	/^GEMINI_/,
	/^GOOGLE_GEMINI_/,
	/^GOOGLE_API_KEY$/,
	/^OPENAI_/,
	/^ANTHROPIC_/,
	/^GH_TOKEN$/,
	/_TOKEN$/,
	/_API_KEY$/,
	/SECRET/,
	/PASSWORD/
];

/** Every non-MCP permission target `agy` recognizes, denied unconditionally in headless review calls. */
const DENIED_ACTIONS = [
	'command(*)',
	'unsandboxed(*)',
	'read_file(*)',
	'write_file(*)',
	'read_url(*)',
	'execute_url(*)',
	'download_url(*)'
];

const CONVERSATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function antigravityEnv(env: Env): Record<string, string> {
	return cliEnv(env, STRIPPED);
}

/** Encodes one user turn for `--input-format stream-json` on stdin. */
export function stdinPrompt(text: string): string {
	return `${JSON.stringify({ event: 'user', message: { content: text } })}\n`;
}

export function isConversationUuid(value: string): boolean {
	return CONVERSATION_UUID.test(value);
}

/**
 * Session-only `--settings` JSON (`never saved` by `agy`). Denies every built-in shell, file and network action,
 * permits only the leased MCP server when present, blocks access outside the scratch workspace, and clears any user
 * `modelProvider` override so standard CLI sign-in is used without `GEMINI_API_KEY`.
 */
function sessionSettings(server: string | null): string {
	return JSON.stringify({
		toolPermission: 'request-review',
		permissions: {
			allow: server ? [`mcp(${server}/*)`] : [],
			deny: server ? DENIED_ACTIONS : [...DENIED_ACTIONS, 'mcp(*)']
		},
		allowNonWorkspaceAccess: false,
		disableSlashCommands: true,
		modelProvider: '',
		customModelsConfig: {},
		statusLine: { enabled: false },
		title: { enabled: false },
		notifications: false
	});
}

/**
 * Builds `<cwd>/.agents/agents/recoder.md`. `excludeDefaultComponents: true` with `tools: []` drops built-in tools
 * and default prompt sections; `inheritCustomizations: false` and `inheritMcp: false` keep user skills, rules,
 * plugins, subagents and personal MCP servers out; and `mcpServers` attaches only Recoder's leased HTTP slot with
 * each permitted tool registered eagerly so no lazy schema file read is needed.
 */
function agentMarkdown(system: string, lease: ToolLease | null, tools: readonly string[]): string {
	const lines = [
		'---',
		`name: ${JSON.stringify(CUSTOM_AGENT_NAME)}`,
		'description: "Recoder review agent"',
		'mainAgent: true',
		'subagent: false',
		'commandExecutionPolicy: "off"',
		'excludeDefaultComponents: true',
		'inheritCustomizations: false',
		'inheritMcp: false',
		'hooks: []',
		'rules: []',
		'skills: []',
		'agents: []',
		'plugins: []'
	];

	if (lease && tools.length > 0) {
		lines.push('mcpServers:');
		lines.push(`  - name: ${JSON.stringify(lease.name)}`);
		lines.push(`    serverUrl: ${JSON.stringify(lease.url)}`);
		lines.push('    enabledTools:');
		for (const tool of tools) lines.push(`      - ${JSON.stringify(tool)}`);
		lines.push('    tools:');

		for (const tool of tools) {
			lines.push(`      ${JSON.stringify(tool)}:`);
			lines.push('        eager: true');
		}
	}

	lines.push('tools: []', '---', '', system.trim(), '');

	return lines.join('\n');
}

/**
 * Prepares the isolated workspace (`<root>/antigravity-empty`) and session-only `<root>/settings.json` for a single
 * call or an agent run. Nothing from the repository checkout or user config is copied in.
 */
export async function writeWorkspaceFiles(
	root: string,
	options: { system: string; lease: ToolLease | null; tools: readonly string[] }
): Promise<{ cwd: string; settingsFile: string }> {
	const cwd = join(root, 'antigravity-empty');
	const agentsDir = join(cwd, '.agents', 'agents');
	const settingsFile = join(root, 'settings.json');
	const activeLease = options.tools.length > 0 ? options.lease : null;

	await mkdir(agentsDir, { recursive: true });

	await Promise.all([
		writeFile(join(agentsDir, `${CUSTOM_AGENT_NAME}.md`), agentMarkdown(options.system, activeLease, options.tools), {
			mode: 0o600
		}),
		writeFile(settingsFile, sessionSettings(activeLease?.name ?? null), { mode: 0o600 })
	]);

	return { cwd, settingsFile };
}
