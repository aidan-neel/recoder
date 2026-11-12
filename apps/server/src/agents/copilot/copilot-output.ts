import { readFile } from 'node:fs/promises';
import { emptyTokenUsage, type TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { isSpentPlan, LlmError, UsageLimitError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import type { AgentEvent, AgentReply } from '../contract';
import { quotedLine } from '../quoted-line';

/**
 * The sign-in a Copilot run can see: `gh auth login` signs the GitHub CLI in, and with an empty scratch
 * `COPILOT_HOME` and no `COPILOT_GITHUB_TOKEN` the CLI falls back to `gh auth token`. `copilot login` does not
 * work here: it saves the account under `COPILOT_HOME`, and every run gets an empty scratch one that is deleted
 * after the call, so that sign-in is invisible to the next.
 */
export const GH_LOGIN = 'gh auth login';

/** Longest stretch of the CLI's output quoted in an error or an error event. */
const QUOTED_CHARS = 300;

/** The CLI's sign-in failures word it as missing or expired authentication and name no command. */
const SIGNED_OUT =
	/no authentication|not authenticated|authentication required|please (?:log|sign) ?in|not signed in|login first/i;

/** Copilot's own billing vocabulary for a spent plan, which the shared spent-plan wording does not name. */
const PREMIUM_CAP = /premium requests?/i;

/** A provider throttle the client may retry, told apart from a cap by its wording and the 429 status. */
const THROTTLE = /rate.?limit|too many requests|try again later/i;

/** One JSONL event of `--output-format json`; only the envelope is trusted, the payload per type. `data` is absent on `result`. */
const envelope = z.object({ type: z.string(), data: z.unknown().optional() });

/** `assistant.message` carries the message's full text; `assistant.message_delta` carries one streamed piece. */
const messageData = z.object({
	messageId: z.string(),
	content: z.string().optional(),
	deltaContent: z.string().optional()
});

/**
 * `assistant.reasoning_delta` streams one piece and `assistant.reasoning` carries a part's whole text, the same
 * pair `assistant.message_delta` and `assistant.message` make for the reply. Both payloads are read tolerantly.
 */
const reasoningData = z.object({
	reasoningId: z.string().optional(),
	messageId: z.string().optional(),
	turnId: z.string().optional(),
	deltaContent: z.string().optional(),
	content: z.string().optional(),
	delta: z.string().optional(),
	text: z.string().optional()
});

const failureData = z.object({
	message: z.string(),
	errorType: z.string().optional(),
	statusCode: z.number().optional()
});

/** `model.call_finished` says how a model call ended; any outcome but `success` is a failed call. */
const callData = z.object({ outcome: z.string().optional() });

/**
 * The event one line carries: a streamed piece, an authoritative message, reasoning, a model call starting or
 * ending, a failure, another event the reader does not act on, or garbage.
 */
export type ParsedLine =
	| { type: 'delta'; messageId: string; content: string }
	| { type: 'message'; messageId: string; content: string }
	| { type: 'reasoning-delta'; partId: string; content: string }
	| { type: 'reasoning-message'; partId: string; content: string }
	| { type: 'step-start' }
	| { type: 'step-end'; succeeded: boolean }
	| { type: 'failure'; message: string; statusCode: number | null; errorType: string | null }
	| { type: 'other' }
	| { type: 'invalid' };

/** Reads one stdout line as a Copilot JSONL event; every type the reader does not act on is `other`. */
export function parseEvent(line: string): ParsedLine {
	let value: unknown;

	try {
		value = JSON.parse(line);
	} catch {
		return { type: 'invalid' };
	}

	const event = envelope.safeParse(value);

	if (!event.success) return { type: 'invalid' };

	const { type, data } = event.data;

	if (type === 'assistant.message' || type === 'assistant.message_delta') {
		const parsed = messageData.safeParse(data);

		if (!parsed.success || parsed.data.messageId === undefined) return { type: 'invalid' };

		const content = type === 'assistant.message' ? (parsed.data.content ?? '') : parsed.data.deltaContent;

		if (content === undefined) return { type: 'other' };

		return { type: type === 'assistant.message' ? 'message' : 'delta', messageId: parsed.data.messageId, content };
	}

	if (type === 'assistant.reasoning_delta' || type === 'assistant.reasoning') {
		const parsed = reasoningData.safeParse(data);

		if (!parsed.success) return { type: 'other' };

		const streamed = type === 'assistant.reasoning_delta';
		const content = streamed ? streamedReasoning(parsed.data) : wholeReasoning(parsed.data);

		if (content === undefined) return { type: 'other' };

		const partId = parsed.data.reasoningId ?? parsed.data.messageId ?? parsed.data.turnId ?? 'reasoning';

		return { type: streamed ? 'reasoning-delta' : 'reasoning-message', partId, content };
	}

	if (type === 'model.call_start') return { type: 'step-start' };

	if (type === 'model.call_finished') {
		const parsed = callData.safeParse(data);

		return { type: 'step-end', succeeded: parsed.success && parsed.data.outcome === 'success' };
	}

	if (type === 'session.error') {
		const parsed = failureData.safeParse(data);

		return parsed.success
			? {
					type: 'failure',
					message: parsed.data.message,
					statusCode: parsed.data.statusCode ?? null,
					errorType: parsed.data.errorType ?? null
				}
			: { type: 'invalid' };
	}

	return { type: 'other' };
}

/** The text a streamed `assistant.reasoning_delta` carries, under whichever of its fields the CLI used. */
function streamedReasoning(data: z.infer<typeof reasoningData>): string | undefined {
	return data.deltaContent ?? data.delta ?? data.text;
}

/** The whole text an authoritative `assistant.reasoning` message carries. */
function wholeReasoning(data: z.infer<typeof reasoningData>): string | undefined {
	return data.content ?? data.deltaContent ?? data.text;
}

/** Where the reader sends streamed text as it arrives. */
type TextSink = (event: AgentEvent) => void;

/** What a `session.error` event said of the failure that ended a prompt. */
interface ReportedFailure {
	message: string;
	statusCode: number | null;
	errorType: string | null;
}

/** Where the prompt's latest model call stands: none started yet, one running, or one that ended well or badly. */
type StepState = 'none' | 'running' | 'succeeded' | 'failed';

/**
 * Reads the JSONL output of one prompt: text and reasoning deltas stream as events, each `assistant.message`
 * and `assistant.reasoning` is authoritative for its part so a reply is complete even when the CLI did not
 * stream it, and a `session.error` names the failure. Each `model.call_start` starts a step; see
 * {@link EventReader.startStep} for where a step ends. Every other event type is passed over.
 */
export class EventReader {
	/** Each message the reply is made of, in the order it arrived, and how much of it has been sent. */
	private readonly parts = new Map<string, { content: string; sent: number }>();

	/** Each reasoning part the same way: deltas accumulate and `assistant.reasoning` is authoritative. */
	private readonly reasoning = new Map<string, { content: string; sent: number }>();

	private failure: ReportedFailure | null = null;

	private last: string | null = null;

	private step: StepState = 'none';

	constructor(private readonly onEvent: TextSink) {}

	readonly line = (line: string): void => {
		this.last = line;

		const event = parseEvent(line);

		if (event.type === 'invalid') {
			this.onEvent({
				type: 'error',
				message: `GitHub Copilot printed a line that is not one of its JSONL events: "${quotedLine(line, QUOTED_CHARS)}"`
			});

			return;
		}

		if (event.type === 'other') return;

		if (event.type === 'step-start') {
			this.startStep();

			return;
		}

		if (event.type === 'step-end') {
			if (this.step === 'running') this.step = event.succeeded ? 'succeeded' : 'failed';

			return;
		}

		if (event.type === 'failure') {
			this.failure = event;
			this.onEvent({ type: 'error', message: quotedLine(event.message, QUOTED_CHARS) });

			return;
		}

		if (event.type === 'reasoning-delta') {
			const part = this.thought(event.partId);

			part.content += event.content;
			this.emit('reasoning', event.partId, event.content);

			return;
		}

		if (event.type === 'reasoning-message') {
			const part = this.thought(event.partId);

			part.content = event.content;

			this.emit('reasoning', event.partId, event.content.slice(part.sent));

			return;
		}

		const part = this.part(event.messageId);

		if (event.type === 'message') {
			part.content = event.content;

			this.emit('text', event.messageId, event.content.slice(part.sent));

			return;
		}

		part.content += event.content;
		this.emit('text', event.messageId, event.content);
	};

	/**
	 * The reply as the last message part holds it — a tool turn's earlier messages are narration, and the last
	 * model call's text is the answer — and the error that ended the prompt, if one did.
	 */
	finish(exit: CliExit): AgentReply {
		const text = [...this.parts.values()].at(-1)?.content ?? '';

		if (exit.code !== 0) return { text, error: exitError(exit, this.last, this.failure) };

		if (!text.trim()) {
			return {
				text,
				error: this.failure ? reportedFailure(this.failure) : new LlmError(0, 'GitHub Copilot ended without a reply.')
			};
		}

		return { text };
	}

	/**
	 * Emits the piece of a streamed part not sent yet, as text or reasoning, so the events add up to the part's
	 * content and never repeat it.
	 */
	private emit(kind: 'text' | 'reasoning', id: string, piece: string): void {
		if (!piece) return;

		if (this.step === 'none') this.startStep();

		const part = kind === 'text' ? this.part(id) : this.thought(id);

		part.sent += piece.length;
		this.onEvent({ type: kind, delta: piece, partId: id });
	}

	/**
	 * Starts a step for a model call. The step before it ends here, its usage unknown: its tool calls are done
	 * before the CLI calls the model again, and the CLI reports usage only for the whole prompt, which the run
	 * gives the prompt's last step. A call that failed gets no end, so it never counts as one the provider
	 * answered. Output that no `model.call_start` announced starts a step too, so a prompt is never free.
	 */
	private startStep(): void {
		if (this.step === 'succeeded') this.onEvent({ type: 'usage', usage: emptyTokenUsage() });

		this.step = 'running';
		this.onEvent({ type: 'step-start' });
	}

	private part(id: string): { content: string; sent: number } {
		return this.slot(this.parts, id);
	}

	private thought(id: string): { content: string; sent: number } {
		return this.slot(this.reasoning, id);
	}

	private slot(map: Map<string, { content: string; sent: number }>, id: string): { content: string; sent: number } {
		let part = map.get(id);

		if (!part) {
			part = { content: '', sent: 0 };
			map.set(id, part);
		}

		return part;
	}
}

/**
 * The failure as an `LlmError`: signed out is a 401 naming the sign-in command, a spent plan is a
 * `UsageLimitError` (Copilot's caps reset in hours or a billing cycle, so the app can say so), a bare throttle
 * or 429 is a retryable `LlmError`, and anything else is the message the CLI gave.
 */
function copilotFailure(text: string, statusCode: number | null, errorType: string | null): LlmError {
	if (SIGNED_OUT.test(text)) {
		return new LlmError(401, `GitHub Copilot is signed out. Run: ${GH_LOGIN}, or set COPILOT_GITHUB_TOKEN.`);
	}

	if (isSpentPlan(text) || PREMIUM_CAP.test(text) || errorType === 'quota' || errorType === 'usage_limit') {
		return new UsageLimitError(429, text);
	}

	if (THROTTLE.test(text) || statusCode === 429) return new LlmError(429, text);

	return new LlmError(statusCode ?? 0, text);
}

/** The failure a `session.error` reported, as an `LlmError` that quotes its message redacted and cut. */
function reportedFailure(failure: ReportedFailure): LlmError {
	return copilotFailure(quotedLine(failure.message, QUOTED_CHARS), failure.statusCode, failure.errorType);
}

/** The last non-empty line of raw output, redacted and cut, as an error may quote it. */
function errorLine(line: string | null): string | undefined {
	const trimmed = line?.trim();

	return trimmed ? quotedLine(trimmed, QUOTED_CHARS) : undefined;
}

/** The error of a prompt that exited non-zero: its structured failure, else its stderr, else its last stdout. */
function exitError(
	exit: { code: number; stderr: string },
	lastStdout: string | null,
	reported: ReportedFailure | null
): LlmError {
	if (reported) return reportedFailure(reported);

	const quoted = errorLine(exit.stderr) ?? errorLine(lastStdout);

	return copilotFailure(quoted ?? `GitHub Copilot exited with code ${exit.code}.`, null, null);
}

/** One model's totals in the `--usage-output-file` JSON, as far as a run counts them. */
const usageOfModel = z.object({
	usage: z
		.object({
			inputTokens: z.number().optional(),
			outputTokens: z.number().optional(),
			cacheReadTokens: z.number().optional(),
			cacheWriteTokens: z.number().optional(),
			reasoningTokens: z.number().optional()
		})
		.optional()
});

/**
 * The `--usage-output-file` JSON: cumulative totals per model for the whole session (`agentMetrics` breaks the
 * same totals down per agent, so it is not read again). Written when the session ends, so a resumed session's
 * file counts every prompt so far.
 */
const usageFileSchema = z.object({
	modelMetrics: z.record(z.string(), usageOfModel).optional()
});

type CountField =
	'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens' | 'reasoningOutputTokens';

type UsageFileField = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens';

/** The usage-file field each counted field is read from. */
const FILE_FIELDS: Record<CountField, UsageFileField> = {
	inputTokens: 'inputTokens',
	outputTokens: 'outputTokens',
	cachedInputTokens: 'cacheReadTokens',
	cacheWriteInputTokens: 'cacheWriteTokens',
	reasoningOutputTokens: 'reasoningTokens'
};

/**
 * The cumulative usage totals a prompt's process wrote for `--usage-output-file`, summed over the session's
 * models. Null when the CLI wrote nothing that parses or counted no tokens, so an unknown count never reads as zero.
 */
export async function readUsage(file: string): Promise<TokenUsage | null> {
	let parsed: z.infer<typeof usageFileSchema>;

	try {
		parsed = usageFileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
	} catch {
		return null;
	}

	const entries = Object.values(parsed.modelMetrics ?? {});

	if (entries.length === 0) return null;

	const count = (field: CountField): number | null => {
		const counts = entries
			.map((entry) => entry.usage?.[FILE_FIELDS[field]])
			.filter((value): value is number => value !== undefined);

		return counts.length ? counts.reduce((total, value) => total + value, 0) : null;
	};

	const inputTokens = count('inputTokens');
	const outputTokens = count('outputTokens');

	if (inputTokens === null && outputTokens === null) return null;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: count('cachedInputTokens'),
		cacheWriteInputTokens: count('cacheWriteInputTokens'),
		reasoningOutputTokens: count('reasoningOutputTokens')
	};
}
