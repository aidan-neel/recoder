import { REASONING_EFFORTS } from '@recoder/shared';
import { z } from 'zod';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import { quotedLine } from '../quoted-line';

/**
 * The custom-command protocol, version 1. Recoder writes one request as JSON to the command's stdin and closes
 * it; the command prints events to stdout, one JSON object per line, and exits. `docs/agents/custom-command.md`
 * documents it with a complete example. A change that an older command could misread gets a new version.
 */
export const PROTOCOL = 'recoder.agent';
export const PROTOCOL_VERSION = 1;

const effortSchema = z.enum(REASONING_EFFORTS);

const header = { protocol: z.literal(PROTOCOL), version: z.literal(PROTOCOL_VERSION) };

/** Asks the command who it is and which models it runs. */
const describeRequestSchema = z.object({ ...header, kind: z.literal('describe') });

/** One turn: run the model on the conversation until it answers, calling Recoder's tools over MCP. */
const turnRequestSchema = z.object({
	...header,
	kind: z.literal('turn'),
	model: z.string(),
	reasoningEffort: effortSchema.nullable(),
	system: z.string(),
	/** The conversation so far, oldest first; the last message is the one to answer. */
	messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
	/** What the previous turn's result returned as `session`, so the command can continue its own state. */
	session: z.string().nullable(),
	/** The Recoder tools this turn may call; empty means answer without tools. */
	tools: z.array(
		z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })
	),
	/** Where the tools are served (MCP over streamable HTTP, on loopback); null when there are none. */
	mcp: z.object({ server: z.string(), url: z.string() }).nullable(),
	/** The JSON schema the answer must match, or null for free text. */
	schema: z.record(z.string(), z.unknown()).nullable(),
	/** When Recoder stops the turn, counted from the moment it started the command. */
	timeoutMs: z.number().int().positive()
});

/** Every request Recoder writes, so a test or a command author can check one against the protocol. */
export const requestSchema = z.discriminatedUnion('kind', [describeRequestSchema, turnRequestSchema]);

export type DescribeRequest = z.infer<typeof describeRequestSchema>;
export type TurnRequest = z.infer<typeof turnRequestSchema>;

const count = z.number().int().nonnegative().nullable().optional();

const modelSchema = z.object({
	id: z.string().min(1).max(200),
	label: z.string().min(1).max(200),
	contextWindow: z.number().int().positive().optional(),
	efforts: z.array(effortSchema).optional(),
	defaultEffort: effortSchema.optional()
});

/** Why a turn failed, so Recoder can say what to do: sign in, wait for a limit, or retry. */
const FAILURE_KINDS = ['auth', 'usage_limit', 'rate_limit', 'overloaded', 'invalid_request', 'other'] as const;

/** What the command prints, one JSON object per line. */
const eventSchema = z.discriminatedUnion('type', [
	z.object({
		...header,
		type: z.literal('describe'),
		name: z.string().max(100).optional(),
		agentVersion: z.string().max(100),
		models: z.array(modelSchema).max(500)
	}),
	/** A model call starts. */
	z.object({ ...header, type: z.literal('step'), id: z.string().max(200).optional() }),
	z.object({ ...header, type: z.literal('text'), text: z.string() }),
	z.object({ ...header, type: z.literal('reasoning'), text: z.string() }),
	/** A model call ended, having used this much. */
	z.object({
		...header,
		type: z.literal('usage'),
		id: z.string().max(200).optional(),
		inputTokens: count,
		outputTokens: count,
		cachedInputTokens: count,
		cacheWriteInputTokens: count,
		reasoningOutputTokens: count
	}),
	/** Something went wrong that the turn survives; it is logged. */
	z.object({ ...header, type: z.literal('warning'), message: z.string().max(2000) }),
	/** The turn failed; nothing after it is read. */
	z.object({ ...header, type: z.literal('error'), kind: z.enum(FAILURE_KINDS), message: z.string().max(2000) }),
	/** The turn's answer, as text and, when a schema was asked for, as the object; it ends the turn. */
	z.object({
		...header,
		type: z.literal('result'),
		text: z.string(),
		structured: z.unknown().optional(),
		session: z.string().max(10_000).nullable().optional()
	})
]);

export type CommandEvent = z.infer<typeof eventSchema>;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** Longest stretch of an invalid line quoted in an error. */
const QUOTED_CHARS = 200;

const versionSchema = z.object({ protocol: z.literal(PROTOCOL), version: z.number() });

/**
 * One line of the command's output as an event. Throws an `LlmError` that quotes the line, credentials redacted,
 * when it is not JSON, speaks another protocol version, or does not match the event schema.
 */
export function parseEvent(line: string, name: string): CommandEvent {
	const quoted = `"${quotedLine(line, QUOTED_CHARS)}"`;
	let value: unknown;

	try {
		value = JSON.parse(line);
	} catch {
		throw new LlmError(0, `${name} printed a line that is not JSON: ${quoted}.`);
	}

	const versioned = versionSchema.safeParse(value);

	if (!versioned.success) throw new LlmError(0, `${name} printed a line without "protocol": "${PROTOCOL}": ${quoted}.`);

	if (versioned.data.version !== PROTOCOL_VERSION) {
		throw new LlmError(
			0,
			`${name} speaks protocol version ${versioned.data.version}; Recoder speaks version ${PROTOCOL_VERSION}.`
		);
	}

	const event = eventSchema.safeParse(value);

	if (!event.success) {
		const issue = event.error.issues[0];

		throw new LlmError(
			0,
			`${name} printed an invalid event (${issue.path.join('.') || 'event'}: ${issue.message}): ${quoted}.`
		);
	}

	return event.data;
}

/** HTTP-like statuses for each failure kind, so retries, limits and sign-in messages work as for other providers. */
const FAILURE_STATUS: Record<FailureKind, number> = {
	auth: 401,
	usage_limit: 402,
	rate_limit: 429,
	overloaded: 529,
	invalid_request: 400,
	other: 0
};

/** The error a command's `error` event stands for. A spent plan is a usage limit; a rate limit is retried. */
export function failureError(kind: FailureKind, message: string, name: string): LlmError {
	if (kind === 'auth') return new LlmError(401, `${name} is not signed in: ${message}`);
	if (kind === 'usage_limit') return new UsageLimitError(FAILURE_STATUS[kind], `${name}: ${message}`);

	return new LlmError(FAILURE_STATUS[kind], `${name}: ${message}`);
}
