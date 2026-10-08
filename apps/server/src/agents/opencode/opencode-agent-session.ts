import { z } from 'zod';
import type { ReasoningEffort } from '@recoder/shared';
import { LlmError, cancelledError } from '../../models/llm/errors';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import { emptyDirectory } from '../cli-process';
import { OPENCODE_EMPTY_DIR, isEmptyObject, variantFor, type OpenCodeChatHost } from './opencode-chat';
import type { OpenCodeApi } from './api/types';
import { OpenCodeError } from './opencode-error';
import { followSession, type SessionHandlers } from './opencode-events';
import { toolHost, type ToolLease, type ToolRunner } from './opencode-mcp';
import { abortSession, createSession, deleteSession, type SessionScope } from './opencode-session';

/** What an agent session needs of the OpenCode agent: the server, a model's efforts, and which models refuse a schema. */
export interface OpenCodeAgentHost extends OpenCodeChatHost {
	noStructuredOutput: Set<string>;
}

export interface AgentSessionOptions {
	model: string;
	reasoningEffort?: ReasoningEffort;
	system: string;
	/** Recoder tools the agent may call; none makes it a single answer. */
	tools: string[];
	runTool: ToolRunner;
	handlers: SessionHandlers;
	signal: AbortSignal;
}

/** How one prompt ended: the final answer as an object or as text, or the error that stopped the run. */
export interface AgentReply {
	structured?: unknown;
	text: string;
	error?: LlmError;
}

interface PromptOptions {
	/** Off on the final turn, so the model can only answer. */
	tools: boolean;
	schema?: Record<string, unknown>;
	timeoutMs: number;
}

const PLAIN_RESULT = `Send your final result now. ${JSON_MODE_INSTRUCTION}`;

/** The provider refused the forced tool call, or the model never made it. */
export function refusesStructuredOutput(err: LlmError): boolean {
	return /tool[_ ]?choice|structured output/i.test(err.message);
}

function asLlmError(error: unknown, aborted: boolean): LlmError {
	if (aborted) return cancelledError();
	if (error instanceof LlmError) return error;
	if (error instanceof OpenCodeError) return new LlmError(error.status, error.message);
	if (error instanceof z.ZodError) return new LlmError(0, 'OpenCode sent a reply Recoder could not read.');

	return new LlmError(0, error instanceof Error ? error.message : 'OpenCode request failed.');
}

/**
 * One OpenCode session that runs an agent: OpenCode drives the model through
 * its steps and calls Recoder's tools itself. Each prompt is a whole run, up
 * to the final answer; a later prompt continues the same session, so the
 * provider's prompt cache carries over.
 */
export class AgentSession {
	private readonly events = new AbortController();

	private constructor(
		private readonly host: OpenCodeAgentHost,
		private readonly scope: SessionScope,
		private readonly options: AgentSessionOptions,
		private readonly api: OpenCodeApi,
		private readonly lease: ToolLease | null,
		private readonly id: string,
		private readonly variant: string | undefined
	) {}

	static async open(host: OpenCodeAgentHost, options: AgentSessionOptions): Promise<AgentSession> {
		const scope = { server: host.server, directory: await emptyDirectory(OPENCODE_EMPTY_DIR) };
		const api = await host.server.api();
		const variant = await variantFor(host, options);
		const lease = options.tools.length ? await toolHost.lease(scope, options.runTool, options.signal) : null;

		let session: AgentSession | null = null;

		try {
			const id = await createSession(
				{ ...scope, model: options.model, system: options.system, variant, signal: options.signal },
				lease ? [`${lease.prefix}_*`] : []
			);

			session = new AgentSession(host, scope, options, api, lease, id, variant);
			await followSession(host.server, scope.directory, () => id, options.handlers, session.events.signal);

			return session;
		} catch (error) {
			if (session) await session.close();
			else lease?.release();

			throw error;
		}
	}

	private toolNames(tools: boolean): string[] {
		return tools && this.lease ? this.options.tools.map((name) => `${this.lease!.prefix}_${name}`) : [];
	}

	private async send(text: string, prompt: PromptOptions, structured: boolean): Promise<AgentReply> {
		try {
			const reply = await this.api.prompt({
				session: this.id,
				directory: this.scope.directory,
				text,
				model: this.options.model,
				system: this.options.system,
				variant: this.variant,
				tools: this.toolNames(prompt.tools),
				schema: structured ? prompt.schema : undefined,
				timeoutMs: prompt.timeoutMs,
				signal: this.options.signal
			});

			const answer = reply.texts.at(-1) ?? '';

			if (reply.error) return { text: answer, error: reply.error };

			if (structured && (reply.structured === undefined || isEmptyObject(reply.structured)))
				return { text: answer, error: new LlmError(0, 'The model returned empty structured output.') };

			return { structured: structured ? reply.structured : undefined, text: answer };
		} catch (error) {
			return { text: '', error: asLlmError(error, this.options.signal.aborted) };
		}
	}

	/**
	 * Runs the agent on `text` until it answers. A model that will not answer
	 * through the structured-output tool is asked once more for plain JSON, and
	 * later sessions of that model skip the tool.
	 */
	async prompt(text: string, prompt: PromptOptions): Promise<AgentReply> {
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
		await abortSession(this.scope, this.id, true);
	}

	async close(): Promise<void> {
		this.events.abort();
		await this.abort();
		await deleteSession(this.scope, this.id);
		this.lease?.release();
	}
}
