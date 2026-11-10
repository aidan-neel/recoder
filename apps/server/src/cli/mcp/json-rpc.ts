import { z } from 'zod';

/** The JSON-RPC 2.0 error codes this server answers with. */
export const RPC_ERROR = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603
} as const;

type RpcErrorCode = (typeof RPC_ERROR)[keyof typeof RPC_ERROR];

/** MCP request ids are strings or integers, never null. */
const requestIdSchema = z.union([z.string(), z.int()]);

const paramsSchema = z.record(z.string(), z.unknown()).optional();

const requestSchema = z.object({
	jsonrpc: z.literal('2.0'),
	id: requestIdSchema,
	method: z.string(),
	params: paramsSchema
});

const notificationSchema = z.object({ jsonrpc: z.literal('2.0'), method: z.string(), params: paramsSchema });

const readableIdSchema = z.object({ id: requestIdSchema });

export type RequestId = z.infer<typeof requestIdSchema>;

export type RpcRequest = z.infer<typeof requestSchema>;

export type RpcNotification = z.infer<typeof notificationSchema>;

interface RpcResultResponse {
	jsonrpc: '2.0';
	id: RequestId;
	result: object;
}

/** An error reply. It has no id when the id of the message it answers could not be read. */
interface RpcErrorResponse {
	jsonrpc: '2.0';
	id?: RequestId;
	error: { code: RpcErrorCode; message: string };
}

export type RpcResponse = RpcResultResponse | RpcErrorResponse;

/** One message from the client: a request, a notification, or something else, with the error reply it earns. */
export type IncomingMessage =
	| { kind: 'request'; request: RpcRequest }
	| { kind: 'notification'; notification: RpcNotification }
	| { kind: 'invalid'; reply: RpcErrorResponse };

/** One line from the client: a single message, or a batch of them. */
type IncomingLine = { kind: 'single'; message: IncomingMessage } | { kind: 'batch'; messages: IncomingMessage[] };

/**
 * Reads one line as JSON-RPC. A message with an `id` is a request and must be a whole one; a message without is a
 * notification. A non-empty array is a batch, which MCP 2025-03-26 says a server must accept; each of its elements is
 * read as a single message would be. An empty array is one invalid request, as JSON-RPC 2.0 answers it.
 */
export function readLine(line: string): IncomingLine {
	const parsed = parseJson(line);

	if (parsed === null) {
		return {
			kind: 'single',
			message: { kind: 'invalid', reply: errorResponse(undefined, RPC_ERROR.parse, 'Parse error') }
		};
	}

	const { value } = parsed;

	if (Array.isArray(value) && value.length > 0) return { kind: 'batch', messages: value.map(classify) };

	return { kind: 'single', message: classify(value) };
}

export function resultResponse(id: RequestId, result: object): RpcResultResponse {
	return { jsonrpc: '2.0', id, result };
}

export function errorResponse(id: RequestId | undefined, code: RpcErrorCode, message: string): RpcErrorResponse {
	const error = { code, message };

	return id === undefined ? { jsonrpc: '2.0', error } : { jsonrpc: '2.0', id, error };
}

/** The line's JSON value; null when the line is not JSON. */
function parseJson(line: string): { value: unknown } | null {
	try {
		return { value: JSON.parse(line) };
	} catch (error) {
		if (error instanceof SyntaxError) return null;

		throw error;
	}
}

function classify(value: unknown): IncomingMessage {
	if (hasId(value)) {
		const request = requestSchema.safeParse(value);

		if (request.success) return { kind: 'request', request: request.data };

		return { kind: 'invalid', reply: invalidRequest(value) };
	}

	const notification = notificationSchema.safeParse(value);

	if (notification.success) return { kind: 'notification', notification: notification.data };

	return { kind: 'invalid', reply: invalidRequest(value) };
}

function hasId(value: unknown): boolean {
	return typeof value === 'object' && value !== null && 'id' in value;
}

/** The reply to a message that is not a request or a notification, under its id when that id can be read. */
function invalidRequest(value: unknown): RpcErrorResponse {
	const readable = readableIdSchema.safeParse(value);

	return errorResponse(readable.success ? readable.data.id : undefined, RPC_ERROR.invalidRequest, 'Invalid Request');
}
