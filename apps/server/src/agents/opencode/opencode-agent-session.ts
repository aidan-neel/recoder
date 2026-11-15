import { z } from 'zod';
import { OpenCodeWarmStart } from './opencode-warm-start';
import type { ImageUpload } from '@recoder/shared';
import { LlmError, cancelledError } from '../../models/llm/errors';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { promptPrefix } from '../../models/prompt-prefix';
import { emptyDirectory } from '../cli-process';
import type { AgentPromptOptions, AgentReply, AgentRun, AgentRunOptions } from '../contract';
import type { SessionToolLease } from '../tools/mcp-host';
import { OPENCODE_EMPTY_DIR, isEmptyObject, variantFor, type OpenCodeChatHost } from './opencode-chat';
import type { OpenCodeApi } from './api/types';
import { OpenCodeError, providerError } from './opencode-error';
import { eventHandlers, followSession } from './opencode-events';
import { leaseOpenCodeTools } from './opencode-mcp';
import { abortSession, createSession, deleteSession, type SessionScope } from './opencode-session';

/** What an agent session needs of the OpenCode agent: the server, a model's efforts, and which models refuse a schema. */
export interface OpenCodeAgentHost extends OpenCodeChatHost {
	noStructuredOutput: Set<string>;
}

const PLAIN_RESULT = `Send your final result now. ${JSON_MODE_INSTRUCTION}`;

/** The provider refused the forced tool call, or the model never made it. */
export function refusesStructuredOutput(err: LlmError): boolean {
	return /tool[_ ]?choice|structured output/i.test(err.message);
}

function asLlmError(error: unknown, aborted: boolean): LlmError {
	if (aborted) return cancelledError();
	if (error instanceof LlmError) return error;
	if (error instanceof OpenCodeError) return providerError(error.status, error.message);
	if (error instanceof z.ZodError) return new LlmError(0, 'OpenCode sent a reply Recoder could not read.');

	return new LlmError(0, error instanceof Error ? error.message : 'OpenCode request failed.');
}

/**
 * One OpenCode session that runs an agent: OpenCode drives the model through
 * its steps and calls Recoder's tools itself. Each prompt is a whole run, up
 * to the final answer; a later prompt continues the same session, so the
 * provider's prompt cache carries over.
 */
export class OpenCodeAgentRun implements AgentRun {
	private readonly events = new AbortController();
	private turn = 0;
	private opening?: string;
	private setAnswerOnly: (value: boolean) => void = () => {};
	private stopped = new AbortController();
	/** The brief's images, until the first prompt sends them; the session holds them after that. */
	private unsentImages: readonly ImageUpload[];

	private constructor(
		private readonly host: OpenCodeAgentHost,
		private readonly scope: SessionScope,
		private readonly options: AgentRunOptions,
		private readonly api: OpenCodeApi,
		private readonly lease: SessionToolLease | null,
		private readonly id: string,
		private readonly variant: string | undefined,
		private readonly warmStart: OpenCodeWarmStart
	) {
		this.unsentImages = options.images ?? [];
	}

	static async open(host: OpenCodeAgentHost, options: AgentRunOptions): Promise<OpenCodeAgentRun> {
		const scope = { server: host.server, directory: await emptyDirectory(OPENCODE_EMPTY_DIR) };
		const api = await host.server.api();
		const variant = await variantFor(host, options);
		let answerOnly = false;

		const lease = options.tools.length
			? await leaseOpenCodeTools(scope, {
					...options,
					runTool: (name, args) =>
						answerOnly
							? Promise.resolve({
									text: 'This is your final turn. Give your final result without tools.',
									isError: true
								})
							: options.runTool(name, args)
				})
			: null;

		let session: OpenCodeAgentRun | null = null;
		let root: string | undefined;

		try {
			const id = await createSession(
				{ ...scope, model: options.model, system: options.system, variant, signal: options.signal },
				lease ? [`${lease.name}_*`] : [],
				(id) => {
					root = id;
				}
			);

			lease?.bindSession(id);

			const warmStart = new OpenCodeWarmStart(root, lease?.name, options.system);

			session = new OpenCodeAgentRun(host, scope, options, api, lease, id, variant, warmStart);

			session.setAnswerOnly = (value) => {
				answerOnly = value;
			};

			await followSession(
				host.server,
				scope.directory,
				() => id,
				{
					...eventHandlers(options.onEvent),
					onStepEnd: () => warmStart.release()
				},
				session.events.signal
			);

			return session;
		} catch (error) {
			if (session) await session.close();
			else lease?.release();

			throw error;
		}
	}

	private toolNames(): string[] {
		return this.lease ? this.options.tools.map((name) => `${this.lease!.name}_${name}`) : [];
	}

	/** The tool part of the cached prefix: the catalog, and the answer format OpenCode adds as a tool. */
	private toolsFingerprint(prompt: AgentPromptOptions, structured: boolean): string {
		const format = structured && prompt.schema ? JSON.stringify(prompt.schema) : '';

		return `${this.lease?.name ?? ''}\n${format}`;
	}

	private async send(text: string, prompt: AgentPromptOptions, structured: boolean): Promise<AgentReply> {
		const signal = AbortSignal.any([this.options.signal, this.stopped.signal, this.events.signal]);

		try {
			this.setAnswerOnly(!prompt.tools);
			await this.warmStart.wait(signal);

			const images = this.unsentImages;

			this.unsentImages = [];
			this.opening ??= text;

			this.options.onEvent({
				type: 'prompt-start',
				session: this.id,
				turn: ++this.turn,
				prefix: promptPrefix(this.toolsFingerprint(prompt, structured), this.options.system, this.opening)
			});

			const reply = await this.api.prompt({
				session: this.id,
				directory: this.scope.directory,
				text,
				images,
				model: this.options.model,
				system: this.options.system,
				variant: this.variant,
				tools: this.toolNames(),
				schema: structured ? prompt.schema : undefined,
				timeoutMs: prompt.timeoutMs,
				signal
			});

			const answer = reply.texts.at(-1) ?? '';

			const { tokens } = reply;

			if (reply.error) return { text: answer, error: reply.error, tokens };

			if (structured && (reply.structured === undefined || isEmptyObject(reply.structured)))
				return { text: answer, error: new LlmError(0, 'The model returned empty structured output.'), tokens };

			return { structured: structured ? reply.structured : undefined, text: answer, tokens };
		} catch (error) {
			return { text: '', error: asLlmError(error, signal.aborted) };
		} finally {
			this.warmStart.release();
		}
	}

	/**
	 * Runs the agent on `text` until it answers. A model that will not answer
	 * through the structured-output tool is asked once more for plain JSON, and
	 * later sessions of that model skip the tool.
	 */
	async prompt(text: string, prompt: AgentPromptOptions): Promise<AgentReply> {
		const { model } = this.options;
		const structured = Boolean(prompt.schema) && this.api.structuredOutput && !this.host.noStructuredOutput.has(model);
		const plain = prompt.schema && !structured ? `${text}\n\n${JSON_MODE_INSTRUCTION}` : text;
		const reply = await this.send(plain, prompt, structured);

		if (!structured || !reply.error || !refusesStructuredOutput(reply.error)) return reply;

		this.host.noStructuredOutput.add(model);

		return this.send(PLAIN_RESULT, { ...prompt, tools: false }, false);
	}

	/** Stops the run in progress; its prompt then settles with a cancelled error. */
	async abort(): Promise<void> {
		const stopped = this.stopped;

		this.stopped = new AbortController();
		stopped.abort();
		this.warmStart.release();
		await abortSession(this.scope, this.id, true);
	}

	async close(): Promise<void> {
		this.events.abort();
		this.lease?.release();
		await this.abort();
		await deleteSession(this.scope, this.id);
	}
}
