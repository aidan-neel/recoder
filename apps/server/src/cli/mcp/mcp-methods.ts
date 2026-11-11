import { z } from 'zod';
import { VERSION } from '../../version.js';
import { RPC_ERROR, errorResponse, resultResponse, type RpcRequest, type RpcResponse } from './json-rpc.js';
import type { ToolCallContext } from './tool.js';
import { findTool, listTools } from './tools.js';

/**
 * The MCP revisions this server speaks, newest first: every revision that opens with `initialize`. What this server
 * uses (`initialize`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled`) is the same in each.
 */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const initializeParamsSchema = z.object({ protocolVersion: z.string() });

const callParamsSchema = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() });

/**
 * One session's requests through MCP's lifecycle: the client sends `initialize` first, and the server answers nothing
 * else before a successful one but `ping`. A request that comes too early, or a second `initialize`, is an invalid
 * request; notifications need no answer, so the session ignores those that come early.
 */
export class McpMethods {
	private isInitialized = false;

	/**
	 * Answers one request. Whether it may run is settled when this is called, before its first await, so requests are
	 * judged in the order they arrive: one sent right behind a successful `initialize` runs. Every failure the client
	 * can cause is a reply; this rejects only on a bug.
	 */
	async answer(request: RpcRequest, context: ToolCallContext): Promise<RpcResponse> {
		if (request.method === 'ping') return resultResponse(request.id, {});

		if (request.method === 'initialize') return this.initializeOnce(request);

		if (!this.isInitialized) return notInitialized(request);

		return answerOperation(request, context);
	}

	private initializeOnce(request: RpcRequest): RpcResponse {
		if (this.isInitialized) {
			return errorResponse(request.id, RPC_ERROR.invalidRequest, 'Invalid Request: the server is already initialized');
		}

		const response = initialize(request);

		this.isInitialized = 'result' in response;

		return response;
	}
}

function notInitialized(request: RpcRequest): RpcResponse {
	return errorResponse(
		request.id,
		RPC_ERROR.invalidRequest,
		'Invalid Request: the server is not initialized; send initialize first'
	);
}

/** A request of the session's operation, once it is initialized. */
async function answerOperation(request: RpcRequest, context: ToolCallContext): Promise<RpcResponse> {
	switch (request.method) {
		case 'tools/list':
			return resultResponse(request.id, { tools: listTools() });
		case 'tools/call':
			return callTool(request, context);
		default:
			return errorResponse(request.id, RPC_ERROR.methodNotFound, `Method not found: ${request.method}`);
	}
}

/** The client's version when this server speaks it; otherwise the newest this server speaks, for the client to judge. */
function initialize(request: RpcRequest): RpcResponse {
	const params = initializeParamsSchema.safeParse(request.params);

	if (!params.success) {
		return errorResponse(request.id, RPC_ERROR.invalidParams, 'Invalid params: initialize needs a protocolVersion');
	}

	const requested = params.data.protocolVersion;
	const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];

	return resultResponse(request.id, {
		protocolVersion,
		capabilities: { tools: {} },
		serverInfo: { name: 'recoder', version: VERSION }
	});
}

/** An unknown tool or a call without a name is a protocol error; arguments the tool refuses are a tool result. */
async function callTool(request: RpcRequest, context: ToolCallContext): Promise<RpcResponse> {
	const params = callParamsSchema.safeParse(request.params);

	if (!params.success) {
		return errorResponse(request.id, RPC_ERROR.invalidParams, 'Invalid params: tools/call needs a tool name');
	}

	const tool = findTool(params.data.name);

	if (tool === undefined) {
		return errorResponse(request.id, RPC_ERROR.invalidParams, `Unknown tool: ${params.data.name}`);
	}

	return resultResponse(request.id, await tool.call(params.data.arguments ?? {}, context));
}
