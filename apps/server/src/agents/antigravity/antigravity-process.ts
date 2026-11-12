import { rmSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cliEnv } from '../cli-process';
import type { ToolLease } from '../tools/mcp-host';
import { deleteConversationSummaryRecords } from './antigravity-summaries';

export type Env = Record<string, string | undefined>;

export interface TrackedConversation {
	env: Env;
	id: string;
}

export const ANTIGRAVITY_LOGIN = 'agy acp --login';

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

interface ConversationArtifacts {
	paths: string[];
	summariesDb: string;
	summariesProto: string;
}

/**
 * Per-conversation files and shared summary stores under `~/.gemini/antigravity-cli`. `agy` 1.5.6 offers neither a flag
 * to skip session persistence nor a subcommand to delete one conversation, so Recoder removes the SQLite store,
 * annotation, presence lock, brain directory, `conversation_summaries.db` rows and `jetbox_summaries_proto.pb` entry
 * directly; note that an external `agy` session running concurrently does not take Recoder's SQLite lock when rewriting
 * `jetbox_summaries_proto.pb`.
 */
function conversationArtifacts(env: Env, id: string): ConversationArtifacts | null {
	if (!isConversationUuid(id)) return null;

	const base = join(env.HOME || homedir(), '.gemini', 'antigravity-cli');

	return {
		paths: [
			join(base, 'conversations', `${id}.db`),
			join(base, 'conversations', `${id}.db-wal`),
			join(base, 'conversations', `${id}.db-shm`),
			join(base, 'annotations', `${id}.pbtxt`),
			join(base, 'presence', `${id}.lock`),
			join(base, 'brain', id)
		],
		summariesDb: join(base, 'conversation_summaries.db'),
		summariesProto: join(base, 'jetbox_summaries_proto.pb')
	};
}

async function removeConversation(env: Env, id: string): Promise<void> {
	const artifacts = conversationArtifacts(env, id);

	if (!artifacts) return;

	await Promise.all([
		...artifacts.paths.map((target) => rm(target, { recursive: true, force: true })),
		Promise.resolve().then(() => deleteConversationSummaryRecords(artifacts.summariesDb, artifacts.summariesProto, id))
	]);
}

/**
 * Tracks conversations started by one completion or agent run, registering each ID in the adapter's shutdown sweep set
 * as soon as `init` announces it and removing it only after {@link removeAll} has deleted its files and summary rows.
 */
export class ConversationTracker {
	latestId: string | null = null;

	private readonly local = new Map<string, TrackedConversation>();

	constructor(
		private readonly env: Env,
		private readonly active: Set<TrackedConversation>
	) {}

	readonly add = (id: string): void => {
		this.latestId = id;

		if (this.local.has(id)) return;

		const entry: TrackedConversation = { env: this.env, id };

		this.local.set(id, entry);
		this.active.add(entry);
	};

	async removeAll(): Promise<void> {
		const entries = [...this.local.values()];

		await Promise.all(
			entries.map((entry) =>
				removeConversation(entry.env, entry.id).then(() => {
					this.local.delete(entry.id);
					this.active.delete(entry);
				})
			)
		);
	}
}

/** Synchronously deletes every tracked in-flight conversation's files and summary rows when the server exits. */
export function sweepConversations(entries: Set<TrackedConversation>): void {
	let firstFailure: unknown = null;

	for (const entry of [...entries]) {
		const artifacts = conversationArtifacts(entry.env, entry.id);

		if (!artifacts) {
			entries.delete(entry);
			continue;
		}

		try {
			for (const target of artifacts.paths) rmSync(target, { recursive: true, force: true });
			deleteConversationSummaryRecords(artifacts.summariesDb, artifacts.summariesProto, entry.id);
			entries.delete(entry);
		} catch (sweepError) {
			firstFailure ??= sweepError;
		}
	}

	if (firstFailure !== null) throw firstFailure;
}
