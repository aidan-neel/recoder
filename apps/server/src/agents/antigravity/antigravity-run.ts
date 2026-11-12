import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelEntry } from '@recoder/shared';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli } from '../cli-stream';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import { effortArgs } from './antigravity-models';
import {
	ANTIGRAVITY_STREAM_ARGS,
	ConversationTracker,
	antigravityEnv,
	stdinPrompt,
	writeWorkspaceFiles,
	type Env,
	type TrackedConversation
} from './antigravity-process';
import { RunReader } from './antigravity-run-reader';

/** Adapter resources shared with each open {@link AntigravityRun}. */
interface AntigravityHost {
	path: string;
	env: Env;
	known: ReadonlyMap<string, ModelEntry>;
	running: Set<Bun.Subprocess>;
	scratch: Set<string>;
	conversations: Set<TrackedConversation>;
}

/**
 * Antigravity CLI (`agy`) as the review agent: one `agy` process per prompt, resuming the conversation ID the first
 * prompt created. Built-in tools stay off (`excludeDefaultComponents: true` plus `permissions.deny`), so the model
 * reaches the repository exclusively through Recoder's MCP host.
 */
export class AntigravityRun extends ProcessRun {
	private cwd = '';
	private settingsFile = '';
	private readonly conversations: ConversationTracker;

	private constructor(
		private readonly host: AntigravityHost,
		options: AgentRunOptions,
		private readonly root: string
	) {
		super(options);
		this.conversations = new ConversationTracker(host.env, host.conversations);
	}

	static async open(host: AntigravityHost, options: AgentRunOptions): Promise<AntigravityRun> {
		const root = await mkdtemp(join(tmpdir(), 'recoder-antigravity-run-'));

		host.scratch.add(root);

		const instance = new AntigravityRun(host, options, root);

		await instance.prepareWorkspace().catch(async (setupError: unknown) => {
			await instance.close();
			throw setupError;
		});

		return instance;
	}

	/**
	 * Sends `text` as one headless turn. `agy --json-schema` relies on its internal `finish` tool loop, which is off
	 * when built-in tools are excluded, so structured turns append {@link JSON_MODE_INSTRUCTION} to the prompt.
	 */
	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const content = options.schema ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;

		return this.executeTurn(content, options.timeoutMs);
	}

	/** Removes the run's temporary workspace/settings and awaits deletion of every conversation `agy` saved for it. */
	protected override async cleanUp(): Promise<void> {
		await Promise.all([
			rm(this.root, { recursive: true, force: true }).then(() => {
				this.host.scratch.delete(this.root);
			}),
			this.conversations.removeAll()
		]);
	}

	private async prepareWorkspace(): Promise<void> {
		const files = await writeWorkspaceFiles(this.root, {
			system: this.options.system,
			lease: this.lease,
			tools: this.options.tools
		});

		this.cwd = files.cwd;
		this.settingsFile = files.settingsFile;
	}

	private async executeTurn(content: string, timeoutMs: number): Promise<AgentReply> {
		const deadline = this.begin(timeoutMs);
		const reader = new RunReader(this.options.onEvent, this.conversations.add);
		const splitter = new LineSplitter(reader.line);
		const wasResumed = this.conversations.latestId !== null;

		try {
			const exit = await streamCli({
				argv: [this.host.path, ...this.args()],
				cwd: this.cwd,
				env: antigravityEnv(this.host.env),
				stdin: stdinPrompt(content),
				signal: deadline.signal,
				maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
				onOutput: splitter.push,
				running: this.host.running,
				name: 'Antigravity'
			});

			splitter.end();

			return wasResumed ? reader.finishResumedTurn(exit) : reader.finishInitialTurn(exit);
		} catch (turnError) {
			splitter.end();

			return { text: '', error: deadline.failure(turnError, 'Antigravity run failed.') };
		}
	}

	private args(): string[] {
		const resumedId = this.conversations.latestId;

		return [
			...ANTIGRAVITY_STREAM_ARGS,
			'--settings',
			this.settingsFile,
			'--model',
			this.options.model,
			...effortArgs(this.options.model, this.options.reasoningEffort, this.host.known),
			...(resumedId ? ['--conversation', resumedId] : [])
		];
	}
}
