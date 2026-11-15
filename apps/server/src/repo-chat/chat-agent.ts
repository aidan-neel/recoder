import type { Repo, RepoChatMessage } from '@recoder/shared';
import type { LoadedSkill } from '../skills/discovery';
import type { AgentAdapter, AgentEvent, AgentReply, AgentRun, ToolRunner } from '../agents/contract';
import { withMcpToolCatalog } from '../agents/tools/mcp-host';
import { LlmError } from '../models/llm';
import { withUsageMetrics } from '../models/metrics';
import { StepUsage } from '../models/step-usage';
import { attachedSkillsBlock, skillCatalogBlock } from '../skills/prompt';
import { MAX_REPLY_CHARS } from './chat-record';
import { agentConversation } from './chat-prompt';
import {
	CHAT_TOOLS,
	CHAT_RUN_TIMEOUT_MS,
	MAX_CHAT_TOOL_CALLS,
	cappedToolCall,
	chatToolDefinitions,
	runChatTool,
	toolArguments,
	type ChatToolContext
} from './chat-tools';
import { chatSkillCatalog } from './chat-skills';
import { citationsFor, TrailRecorder, type ToolStepDetail } from './chat-trail';
import { recoderSystemPrompt } from './identity';
import type { ReplyJob } from './chat-reply';

/**
 * Writes one repository-chat reply as a single agent run. Text streams into the
 * reply, tool calls become trail steps, and each model step is one `model_calls` row.
 * `close` runs even when the prompt is aborted.
 */
export async function answerWithAgent(
	agent: AgentAdapter,
	job: ReplyJob,
	reply: RepoChatMessage,
	trail: TrailRecorder,
	signal: AbortSignal,
	grew: () => void
): Promise<void> {
	await withUsageMetrics(job.chat.id, 'discussion', async () => {
		const usage = new StepUsage(job.config);
		const { runTool, onEvent } = chatHandlers(job, reply, trail, usage, signal, grew);
		const { text, images } = await agentConversation(job.chat);
		const catalog = skillCatalogBlock(await chatSkillCatalog(job.repo, signal));

		let run: AgentRun | undefined;
		let result: AgentReply | undefined;
		let failed: unknown;

		try {
			run = await withMcpToolCatalog(chatToolDefinitions(), () =>
				agent.openRun({
					model: job.config.model,
					reasoningEffort: job.config.reasoningEffort,
					system: recoderSystemPrompt(CHAT_TOOLS, catalog),
					tools: CHAT_TOOLS.map((tool) => tool.name),
					runTool,
					onEvent,
					signal,
					...(agent.readsImages && images.length > 0 ? { images } : {})
				})
			);

			if (signal.aborted) {
				await run.abort();

				throw new LlmError(0, 'cancelled');
			}

			const onAbort = () => {
				void run?.abort();
			};

			signal.addEventListener('abort', onAbort, { once: true });

			try {
				result = await run.prompt(conversationText(job.repo, text, job.skills), {
					tools: true,
					timeoutMs: CHAT_RUN_TIMEOUT_MS
				});

				if (result.error) throw result.error;
				if (!reply.text) reply.text = result.text.slice(0, MAX_REPLY_CHARS);
			} finally {
				signal.removeEventListener('abort', onAbort);
			}
		} catch (error) {
			failed = error;

			throw error;
		} finally {
			try {
				await usage.finishPrompt(result?.tokens, failed);
			} finally {
				await run?.close();
			}
		}

		trail.endThinking();
		reply.citations = await citationsFor(job.repo, reply.text, signal);
	});
}

function conversationText(repo: Repo, transcript: string, skills: readonly LoadedSkill[]): string {
	const attached = attachedSkillsBlock(skills);

	return `Repository: ${repo.name} (${repo.url}), default branch ${repo.defaultBranch}.\n\n${transcript}${attached ? `\n\n${attached}` : ''}`;
}

/** The tool runner and the event handler for one reply. The runner stops at {@link MAX_CHAT_TOOL_CALLS}. */
function chatHandlers(
	job: ReplyJob,
	reply: RepoChatMessage,
	trail: TrailRecorder,
	usage: StepUsage,
	signal: AbortSignal,
	grew: () => void
): { runTool: ToolRunner; onEvent: (event: AgentEvent) => void } {
	let calls = 0;

	const ctx: ChatToolContext = {
		repo: job.repo,
		signal,
		startedBy: job.chat.startedBy,
		showReview: (shown) => applyReview(reply, shown, grew)
	};

	const runTool: ToolRunner = async (name, args) => {
		if (calls >= MAX_CHAT_TOOL_CALLS) {
			trail.noteToolResult(true);

			return cappedToolCall();
		}

		calls += 1;
		trail.noteToolArgs(name, toolDetail(name, args));

		const outcome = await runChatTool(name, args, ctx).catch((error: unknown) => ({
			text: error instanceof Error ? error.message : 'The tool failed.',
			isError: true
		}));

		trail.noteToolResult(outcome.isError);

		return outcome;
	};

	const onEvent = (event: AgentEvent) => {
		applyEvent(event, reply, trail, usage, grew);
	};

	return { runTool, onEvent };
}

function applyEvent(
	event: AgentEvent,
	reply: RepoChatMessage,
	trail: TrailRecorder,
	usage: StepUsage,
	grew: () => void
): void {
	if (event.type === 'text') {
		reply.text = (reply.text + event.delta).slice(0, MAX_REPLY_CHARS);
		grew();

		return;
	}

	if (event.type === 'reasoning') {
		trail.addReasoning(event.delta);

		return;
	}

	if (event.type === 'tool-call') {
		trail.noteToolCall(event.name);

		return;
	}

	if (event.type === 'tool-result') {
		trail.noteToolResult(event.isError);

		return;
	}

	if (event.type === 'prompt-start') usage.promptStarted(event);
	else if (event.type === 'step-start') usage.stepStarted(event.step);
	else if (event.type === 'usage') usage.stepFinished(event.usage, event.step);
}

/** Puts a review the tool started onto the reply, the same sentences `reviewFromChat` returns. */
function applyReview(
	reply: RepoChatMessage,
	result: Pick<RepoChatMessage, 'text' | 'review' | 'failure'>,
	grew: () => void
): void {
	if (result.review) reply.review = result.review;
	if (result.failure) reply.failure = result.failure;

	if (result.text && !reply.text.includes(result.text)) {
		reply.text = `${reply.text ? `${reply.text}\n\n` : ''}${result.text}`.slice(0, MAX_REPLY_CHARS);
	}

	grew();
}

function toolDetail(name: string, args: unknown): ToolStepDetail {
	const record = toolArguments(args) ?? {};

	if (name === 'read_file') return readDetail(record);
	if (name === 'search') return searchDetail(record);
	if (name === 'list_files') return listDetail(record);
	if (name === 'start_review') return { command: `start_review #${pullLabel(record)}` };
	if (name === 'load_skill') return { command: `load_skill ${textField(record, 'name') ?? ''}`.trim() };

	return {};
}

function readDetail(record: Record<string, unknown>): ToolStepDetail {
	const path = textField(record, 'path');
	const startLine = integerField(record, 'startLine');
	const endLine = integerField(record, 'endLine');

	return {
		...(path ? { path, files: [path] } : {}),
		...(startLine !== undefined ? { startLine } : {}),
		...(endLine !== undefined ? { endLine } : {})
	};
}

function searchDetail(record: Record<string, unknown>): ToolStepDetail {
	const prefix = textField(record, 'prefix');

	return { query: textField(record, 'query') ?? '', ...(prefix ? { scope: prefix } : {}) };
}

function listDetail(record: Record<string, unknown>): ToolStepDetail {
	const prefix = textField(record, 'prefix');

	return prefix ? { path: prefix, files: [prefix] } : {};
}

function pullLabel(record: Record<string, unknown>): string {
	const pull = integerField(record, 'pull');

	return pull === undefined ? '?' : String(pull);
}

function textField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];

	return typeof value === 'string' ? value : undefined;
}

function integerField(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];

	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}
