import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import type { ToolLease } from '../tools/mcp-host';
import { effortArgs } from './copilot-models';
import { addedUsage, EventReader, readUsage } from './copilot-output';
import { copilotEnvWithHome } from './copilot-process';

type Env = Record<string, string | undefined>;

/**
 * The built-in tools `session.info` reports a prompt-mode run disabling anyway; naming them keeps them out of
 * the model's tool list entirely, so a future built-in the deny kinds do not cover still cannot be called.
 */
const BUILTIN_TOOLS =
	'bash,create,dynamic_workflows_manage,edit,fetch_copilot_cli_documentation,glob,grep,list_agents,list_bash,' +
	'read_agent,read_bash,run_dynamic_workflow,session_store_sql,skill,sql,stop_bash,task,view,write_agent';

/**
 * Prompt mode with every door shut but the model: its built-in tools excluded from the model's list and their
 * kinds denied by rule (a deny rule wins over every allow, and prompt mode denies anything that would ask), its
 * built-in MCP servers off, its custom instructions off, no ask-user, no temp directory, no session sync to the
 * account, and the auth tokens masked in its output. The user's config, hooks, plugins, skills and MCP servers
 * never load because `COPILOT_HOME` points at an empty scratch dir, and the working directory is one nothing
 * trusts, which skips workspace MCP servers, repository hooks and project extensions.
 */
export const PROMPT_ARGS = [
	'--output-format',
	'json',
	'--no-ask-user',
	'--disallow-temp-dir',
	'--disable-builtin-mcps',
	'--no-custom-instructions',
	'--excluded-tools',
	BUILTIN_TOOLS,
	'--deny-tool',
	'shell,write,read,url,memory',
	'--sync-session=off',
	'--secret-env-vars',
	'COPILOT_GITHUB_TOKEN,GITHUB_TOKEN,GH_TOKEN'
];

/** What a run needs of the adapter: the binary, the server's environment, and the sets its `stop` empties. */
export interface CopilotHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
}

/** Where a run lives: a scratch dir holding its `COPILOT_HOME`, its working directory, and its usage file. */
interface RunPlace {
	root: string;
	home: string;
	cwd: string;
	usage: string;
}

function runPlace(root: string): RunPlace {
	return { root, home: join(root, 'home'), cwd: join(root, 'work'), usage: join(root, 'usage.json') };
}

/**
 * The flags that give the CLI Recoder's MCP server and allow its tools, and nothing else: the server is the only
 * one whose tools the model may see (`--available-tools`), and its calls are approved without asking
 * (`--allow-tool` names the server, per the tool-kind docs).
 */
function toolArgs(lease: ToolLease): string[] {
	const config = JSON.stringify({ mcpServers: { [lease.name]: { type: 'http', url: lease.url } } });

	return ['--additional-mcp-config', config, '--available-tools', lease.name, '--allow-tool', lease.name];
}

/**
 * GitHub Copilot as the agent: one prompt-mode process per prompt, all of them the one session `--session-id`
 * names, so a later prompt continues the same conversation. The CLI calls Recoder's tools over MCP; the review
 * gate behind them decides what each call may do.
 */
export class CopilotRun extends ProcessRun {
	private readonly session = randomUUID();

	private prompts = 0;

	private seen: TokenUsage | null = null;

	private constructor(
		private readonly host: CopilotHost,
		options: AgentRunOptions,
		private readonly place: RunPlace
	) {
		super(options);
	}

	static async open(host: CopilotHost, options: AgentRunOptions): Promise<CopilotRun> {
		const place = runPlace(await mkdtemp(join(tmpdir(), 'recoder-copilot-run-')));

		host.scratch.add(place.root);

		const run = new CopilotRun(host, options, place);

		try {
			await mkdir(place.home, { recursive: true });
			await mkdir(place.cwd, { recursive: true });
		} catch (error) {
			await run.close();
			throw error;
		}

		return run;
	}

	/**
	 * Runs the agent on `text` until it answers. The CLI takes no separate system prompt, so the first prompt
	 * carries it. A prompt with `tools` off is given no MCP server at all, so the model cannot even see a tool to
	 * call; the session's earlier tool calls stay in its history. The usage file the CLI writes at its end is the
	 * step's usage, differenced against what earlier prompts of the session already counted.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const reader = new EventReader(this.options.onEvent);
		const lines = new LineSplitter(reader.line);
		const deadline = this.begin(options.timeoutMs);
		const asked = options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;
		const carried = this.prompts === 0 ? `${this.options.system}\n\n${asked}` : asked;

		this.prompts++;
		this.options.onEvent({ type: 'step-start' });

		try {
			const exit = await streamCli({
				argv: [this.host.path, ...this.args(options.tools ? this.lease : null)],
				cwd: this.place.cwd,
				env: copilotEnvWithHome(this.host.env, this.place.home),
				stdin: carried,
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: lines.push,
				running: this.host.running,
				name: 'GitHub Copilot'
			});

			lines.end();

			const tokens = await this.taken();

			return { ...reader.finish(exit), tokens };
		} catch (error) {
			const tokens = await this.taken();

			return { text: '', error: deadline.failure(error, 'GitHub Copilot run failed.'), tokens };
		}
	}

	/** Deletes the run's scratch dir, whose `COPILOT_HOME` holds the session the CLI saved for this run. */
	protected override async cleanUp(): Promise<void> {
		this.host.scratch.delete(this.place.root);
		await rm(this.place.root, { recursive: true, force: true });
	}

	private args(lease: ToolLease | null): string[] {
		return [
			...PROMPT_ARGS,
			...(lease ? toolArgs(lease) : []),
			'--model',
			this.options.model,
			...effortArgs(this.options.reasoningEffort),
			'--session-id',
			this.session,
			'--usage-output-file',
			this.place.usage
		];
	}

	/**
	 * The usage the prompt's process added to the session's file, reported as the end of its step and kept as the
	 * new baseline; the file is removed once read so the next prompt's totals start clean.
	 */
	private async taken(): Promise<TokenUsage | undefined> {
		const total = await readUsage(this.place.usage);

		await rm(this.place.usage, { force: true });

		if (!total) return undefined;

		const usage = addedUsage(total, this.seen);

		this.seen = total;
		this.options.onEvent({ type: 'usage', usage });

		return usage;
	}
}
